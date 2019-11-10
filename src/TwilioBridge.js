var LogService = require("./LogService");
var SmsReceiver = require("./processing/SmsReceiver");
var SmsSender = require("./processing/SmsSender");
var AdminRoomManager = require("./matrix/AdminRoomManager");
var Bridge = require("matrix-appservice-bridge").Bridge;
var TwilioStore = require("./storage/TwilioStore");
var util = require("./utils");
var Promise = require("bluebird");
var _ = require("lodash");
var PubSub = require("pubsub-js");
var PhoneNumberCache = require("./processing/PhoneNumberCache");

class TwilioBridge {
    constructor(config, registration) {
        LogService.info("TwilioBridge", "Constructing bridge");

        this._config = config;
        this._registration = registration;
        this._adminRoomManager = new AdminRoomManager(this);
        this._userPrefix = this._config.advanced.localpartPrefix;

        this._bridge = new Bridge({
            registration: this._registration,
            homeserverUrl: this._config.homeserver.url,
            domain: this._config.homeserver.domain,
            controller: {
                // Only support users. Rooms/3pid not supported.
                onUserQuery: this._onUserQuery.bind(this),
                onEvent: this._onEvent.bind(this),
                onLog: (line, isError) => {
                    var method = isError ? LogService.error : LogService.verbose;
                    method("matrix-appservice-bridge", line);
                }
            },
            suppressEcho: false
        });
    }

    run(port) {
        LogService.info("TwilioBridge", "Starting bridge");
        return this._bridge.run(port, this._config)
            .then(() => this._registerConfigRoutes())
            .then(() => SmsReceiver.setBridge(this))
            .then(() => SmsSender.setBridge(this, this._config))
            .then(() => this._updateBotProfile())
            .then(() => this._bridgeKnownRooms())
            .catch(error => LogService.error("TwilioBridge", error));
    }

    _registerConfigRoutes() {
        PhoneNumberCache.registerNumber(this._config.bridge.phoneNumber, 'user', this._config.bridge.allowedUser);
    }

    /**
     * Gets the bridge bot powering the bridge
     * @return {AppServiceBot} the bridge bot
     */
    getBot() {
        return this._bridge.getBot();
    }

    /**
     * Gets the bridge bot as an intent
     * @return {Intent} the bridge bot
     */
    getBotIntent() {
        return this._bridge.getIntent(this._bridge.getBot().getUserId());
    }

    /**
     * Gets the intent for a sms virtual user
     * @param {string} phoneNumber the phone number (without leading +)
     * @param {boolean} [isRaw] true to treat the phone number as a user ID instead of a phone number
     * @return {Intent} the virtual user intent
     */
    getTwilioIntent(phoneNumber, isRaw = false) {
        if (isRaw && phoneNumber.startsWith("@")) phoneNumber = phoneNumber.substring(1);
        if (isRaw && phoneNumber.indexOf(':') !== -1) phoneNumber = phoneNumber.split(':')[0];
        if (!isRaw && phoneNumber.startsWith("+")) phoneNumber = phoneNumber.substring(1);
        return this._bridge.getIntentFromLocalpart(isRaw ? phoneNumber : (this._userPrefix + phoneNumber));
    }

    /**
     * Determines if the given user ID is a bridged user
     * @param {string} handle the matrix user ID to check
     * @returns {boolean} true if the user ID is a bridged user, false otherwise
     */
    isBridgeUser(handle) {
        return this.getBot().getUserId() == handle || this.isTwilioUser(handle);
    }

    /**
     * Determines if the given user ID is a Twilio bridged user.
     * @param {string} handle the matrix user ID to check
     * @returns {boolean} true if the user ID is a bridged user, false otherwise
     */
    isTwilioUser(handle) {
        return handle.startsWith("@" + this._userPrefix) && handle.endsWith(":" + this._config.homeserver.domain);
    }

    /**
     * Updates the bridge bot's appearance in matrix
     * @private
     */
    _updateBotProfile() {
        LogService.info("TwilioBridge", "Updating appearance of bridge bot");

        var desiredDisplayName = this._config.bot.appearance.displayName || "Twilio Bridge";
        var desiredAvatarUrl = this._config.bot.appearance.avatarUrl || "https://t2bot.io/_matrix/media/v1/download/t2l.io/SOZlqpJCUoecxNFZGGnDEhEy"; // sms icon

        var botIntent = this.getBotIntent();

        TwilioStore.getAccountData('bridge').then(botProfile => {
            var avatarUrl = botProfile.avatarUrl;
            if (!avatarUrl || avatarUrl !== desiredAvatarUrl) {
                util.uploadContentFromUrl(this._bridge, desiredAvatarUrl, botIntent).then(mxcUrl => {
                    LogService.verbose("TwilioBridge", "Avatar MXC URL = " + mxcUrl);
                    LogService.info("TwilioBridge", "Updating avatar for bridge bot");
                    botIntent.setAvatarUrl(mxcUrl);
                    botProfile.avatarUrl = desiredAvatarUrl;
                    TwilioStore.setAccountData('bridge', botProfile);
                });
            }
            botIntent.getProfileInfo(this._bridge.getBot().getUserId(), 'displayname').then(profile => {
                if (profile.displayname != desiredDisplayName) {
                    LogService.info("TwilioBridge", "Updating display name from '" + profile.displayname + "' to '" + desiredDisplayName + "'");
                    botIntent.setDisplayName(desiredDisplayName);
                }
            });
        });
    }

    /**
     * Get all joined members in a room for an Intent
     * @param {Intent} intent the intent to get joined rooms of
     * @return {Promise<*>} resolves to the response of /joined_members
     * @deprecated This is a hack
     */
    // HACK: The js-sdk doesn't support this endpoint. See https://github.com/matrix-org/matrix-js-sdk/issues/440
    getClientJoinedMembers(intent, roomId) {
        // Borrowed from matrix-appservice-bridge: https://github.com/matrix-org/matrix-appservice-bridge/blob/435942dd32e2214d3aa318503d19b10b40c83e00/lib/components/app-service-bot.js#L49-L65
	return intent.getClient()._http.authedRequest(undefined, "GET", "/rooms/" + encodeURIComponent(roomId) + "/joined_members", undefined, undefined, { prefix: "/_matrix/client/r0"} )
            .then(res => {
                if (!res.joined) return {};
                return res.joined;
            });
    }

    /**
     * Updates the bridge information on all rooms the bridge bot participates in
     * @private
     */
    _bridgeKnownRooms() {
        this._bridge.getBot().getJoinedRooms().then(rooms => {
            for (var roomId of rooms) {
                this._processRoom(roomId);
            }
        });
    }

    /**
     * Attempts to determine if a room is a bridged room or an admin room, based on the membership and other
     * room information. This will categorize the room accordingly and prepare it for it's purpose.
     * @param {string} roomId the matrix room ID to process
     * @param {boolean} [isNew] if true, this indicates to the parser that the room is new and not part of a startup routine.
     * @param {String} [inviteTarget] if provided, this indicates which bridge user received the entry to the room
     * @return {Promise<>} resolves when processing is complete
     * @private
     */
    _processRoom(roomId, isNew = false, inviteTarget = null) {
        this._adminRoomManager.tryAddAdminRoom(roomId, isNew).then(null, () => {
            var userPromise = null;
            if (inviteTarget != null && inviteTarget !== this.getBot().getUserId()) {
                userPromise = this.getClientJoinedMembers(this.getTwilioIntent(inviteTarget, true), roomId);
            } else userPromise = this.getBot().getJoinedMembers(roomId);

            return userPromise.then(members => {
                var roomMemberIds = _.keys(members);
                if (roomMemberIds.indexOf(this.getBot().getUserId()) !== -1) return Promise.resolve();

                var botMember = _.filter(roomMemberIds, userId => this.isTwilioUser(userId))[0];
                if (!botMember) {
                    LogService.warn("TwilioBridge", "Failed to find a join Twilio user. Could not invite bridge bot to " + roomId);
                    return Promise.resolve();
                }

                return this.getTwilioIntent(botMember, /*raw:*/true).invite(roomId, this.getBot().getUserId());
            }).then(() => this._tryBridgeRoom(roomId));
        }).catch(err => {
            LogService.error("TwilioBridge", "Error processing room " + roomId);
            LogService.error("TwilioBridge", err);
        });
    }

    _reprocessRoom(roomId) {
        // TODO: Actually process the room (#24)
        return Promise.resolve();
    }

    _tryBridgeRoom(roomId) {
        return this.getBot().getJoinedMembers(roomId)
            .then(members => {
                var roomMemberIds = _.keys(members);
                var twilioCount = _.filter(roomMemberIds, u => this.isTwilioUser(u)).length;

                // Expecting 1 human, 1 bridge, and 1 twilio. So 3 members, and 1 twilio user.
                // If we got this far then the bridge is already in the room.
                if (twilioCount !== 1 || roomMemberIds.length !== 3) {
                    // TODO: Multi-user chat
                    LogService.warn("TwilioBridge", "Room " + roomId + " is a multi-user chat (currently not supported)");
                    return;
                }

                var userId = _.filter(roomMemberIds, u => !this.isBridgeUser(u))[0];

                // It's effectively a 1:1 with another user. Let's see if that user has a phone number
                var phoneNumber = PhoneNumberCache.getNumberForOwner(userId);
                if (!phoneNumber) {
                    LogService.warn("TwilioBridge", "Room " + roomId + " looks like a 1:1, but the user does not have a phone number. Emitting phone number request event.");
                    PubSub.publish("new_direct_chat_without_phone", {
                        userId: userId,
                        roomId: roomId
                    });
                    return;
                }

                var realPhoneNumber = this.getPhoneNumbersFromMembers(_.filter(roomMemberIds, u => this.isTwilioUser(u)))[0];

                LogService.info("TwilioBridge", "Room " + roomId + " appears to be a 1:1 with " + userId + " (" + phoneNumber + ") to " + realPhoneNumber + " - adding route");
                PhoneNumberCache.addUserNumber(realPhoneNumber, phoneNumber, roomId);
            });
    }

    getPhoneNumbersInRoom(roomId) {
        return this.getBot().getJoinedMembers(roomId)
            .then(members => {
                // 2 parts: Find all twilio-looking users, then rip out the phone number from the user ID
                return this.getPhoneNumbersFromMembers(_.filter(_.keys(members), u => this.isTwilioUser(u)));
            }).catch(err => {
                LogService.error("TwilioBridge", "Error getting phone numbers in room " + roomId);
                LogService.error("TwilioBridge", err);
                return [];
            });
    }

    getPhoneNumbersFromMembers(userIds) {
        // Convert @_twilio_+12223334444:domain.com to +12223334444
        // Convert @_twilio_12223334444:domain.com to +12223334444
        return userIds.map(u => u.substring(("@" + this._userPrefix).length).split(':')[0].trim())
            .map(n => n.startsWith("+") ? n : "+" + n);
    }

    /**
     * Creates a new direct chat between a phone number and a target user ID
     * @param {string} fromNumber the number that sent the message
     * @param {string} targetUserId the matrix user ID to chat with
     * @returns {Promise<string>} resolves to the created room ID
     */
    createDirectChat(fromNumber, targetUserId) {
        LogService.info("TwilioBridge", "New direct chat requested for " + targetUserId + " from " + fromNumber);
        var virtualIntent = this.getTwilioIntent(fromNumber);

        var userPowerLevels = {};
        userPowerLevels[targetUserId] = 100;
        userPowerLevels[this.getBot().getUserId()] = 100;
        userPowerLevels[virtualIntent.client.credentials.userId] = 100;

        return virtualIntent.createRoom({
            createAsClient: true, // use intent
            options: {
                invite: [targetUserId, this.getBot().getUserId()],
                is_direct: false,
                preset: "trusted_private_chat",
                visibility: "private",
                initial_state: [
                    {content: {guest_access: "can_join"}, type: "m.room.guest_access", state_key: ""},
                    {
                        content: {
                            users: userPowerLevels,

                            // Defaults from Riot
                            // Note: these are required otherwise the appservice lib crashes us
                            events_default: 0,
                            state_default: 50,
                            users_default: 0,
                            invite: 0,
                            redact: 50,
                            ban: 50,
                            kick: 50,
                            events: {
                                "m.room.avatar": 50,
                                "m.room.name": 50,
                                "m.room.canonical_alias": 50,
                                "m.room.history_visibility": 50,
                                "m.room.power_levels": 50
                            }
                        }, type: "m.room.power_levels", state_key: ""
                    }
                ]
            }
        }).then(room => {
            this.getBotIntent().join(room.room_id); // accept our own invite, just in case it doesn't come our way
            return room.room_id;
        });
    }

    /**
     * Bridge handler to update/create user information
     * @private
     */
    _onUserQuery(matrixUser) {
        var handle = matrixUser.localpart.substring(this._userPrefix.length);
        if (Number(handle) != handle) return Promise.reject("Invalid user ID (not a phone number): " + handle);
        if (handle.startsWith("+")) handle = handle.substring(1);
        return Promise.resolve({
            name: "+" + handle + " (Twilio)",
            remote: new RemoteUser(matrixUser.localpart)
        });
    }

    /**
     * Bridge handler for generic events
     * @private
     */
    _onEvent(request, context) {
        var event = request.getData();
        var roomId = event.room_id;

        this._adminRoomManager.processEvent(roomId, event);

        var returnPromise = Promise.resolve();

        if (event.type === "m.room.member" && event.content.membership === "invite" && this.isBridgeUser(event.state_key)) {
            LogService.info("TwilioBridge", event.state_key + " received invite to room " + event.room_id);
            returnPromise = this._bridge.getIntent(event.state_key).join(event.room_id).then(() => this._processRoom(event.room_id, /*isNew:*/true, /*inviteTarget:*/event.state_key));
        } else if (event.type === "m.room.message" && event.sender !== this.getBot().getUserId()) {
            returnPromise = this._processMessage(event);
        } else if (event.type === "m.room.member") {
            returnPromise = this._reprocessRoom(event.room_id);
        }

        return (returnPromise || Promise.resolve()).catch(err => {
            LogService.error("TwilioBridge", "Error processing event " + event.event_id + " in room " + event.room_id);
            LogService.error("TwilioBridge", err);
        })
    }

    _processMessage(event) {
        if (this.isBridgeUser(event.sender)) return;
        SmsSender.emitMessage(event);
    }
}

module.exports = TwilioBridge;
