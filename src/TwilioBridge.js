var Bridge = require("matrix-appservice-bridge").Bridge;
var LogService = require("./LogService");
var AdminRoom = require("./matrix/AdminRoom");
var SmsStore = require("./storage/TwilioStore");
var Promise = require('bluebird');
var _ = require('lodash');
var util = require("./utils");
var SmsProxy = require("./twilio/SmsProxy");
var RemoteUser = require("matrix-appservice-bridge").RemoteUser;
var AdminRoomManager = require("./matrix/AdminRoomManager");
var PubSub = require("pubsub-js");

class TwilioBridge {
    constructor(config, registration) {
        LogService.info("TwilioBridge", "Constructing bridge");

        this._config = config;
        this._registration = registration;
        this._adminRoomMgr = new AdminRoomManager(this);

        this._userPrefix = this._config.advanced.localpartPrefix;

        this._bridge = new Bridge({
            registration: this._registration,
            homeserverUrl: this._config.homeserver.url,
            domain: this._config.homeserver.domain,
            controller: {
                onEvent: this._onEvent.bind(this),
                // none of these are used because the bridge doesn't allow users to create rooms or users
                // onAliasQuery: this._onAliasQuery.bind(this),
                // onAliasQueried: this._onAliasQueried.bind(this),
                onUserQuery: this._onUserQuery.bind(this),
                onLog: (line, isError) => {
                    var method = isError ? LogService.error : LogService.verbose;
                    method("matrix-appservice-bridge", line);
                }
            },
            suppressEcho: false,
            queue: {
                type: "none",
                perRequest: false
            },
            intentOptions: {
                clients: {
                    dontCheckPowerLevel: true
                },
                bot: {
                    dontCheckPowerLevel: true
                }
            }
        });

        PubSub.subscribe("sms_recv", this._onSms.bind(this));
    }

    run(port) {
        LogService.info("TwilioBridge", "Starting bridge");
        return this._bridge.run(port, this._config)
            .then(() => SmsProxy.init(this._config))
            .then(() => this._updateBotProfile())
            .then(() => this._bridgeKnownRooms())
            .catch(error => LogService.error("TwilioBridge", error));
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

        SmsStore.getAccountData('bridge').then(botProfile => {
            var avatarUrl = botProfile.avatarUrl;
            if (!avatarUrl || avatarUrl !== desiredAvatarUrl) {
                util.uploadContentFromUrl(this._bridge, desiredAvatarUrl, botIntent).then(mxcUrl => {
                    LogService.verbose("TwilioBridge", "Avatar MXC URL = " + mxcUrl);
                    LogService.info("TwilioBridge", "Updating avatar for bridge bot");
                    botIntent.setAvatarUrl(mxcUrl);
                    botProfile.avatarUrl = desiredAvatarUrl;
                    SmsStore.setAccountData('bridge', botProfile);
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
     * @private
     * @deprecated This is a hack
     */
    // HACK: The js-sdk doesn't support this endpoint. See https://github.com/matrix-org/matrix-js-sdk/issues/440
    _getClientJoinedMembers(intent, roomId) {
        // Borrowed from matrix-appservice-bridge: https://github.com/matrix-org/matrix-appservice-bridge/blob/435942dd32e2214d3aa318503d19b10b40c83e00/lib/components/app-service-bot.js#L49-L65
        return intent.getClient()._http.authedRequestWithPrefix(undefined, "GET", "/rooms/" + encodeURIComponent(roomId) + "/joined_members", undefined, undefined, "/_matrix/client/r0")
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
        LogService.info("TwilioBridge", "Request to bridge room " + roomId);

        this._adminRoomMgr.tryAddAdminRoom(roomId, isNew).then(null, () => {
            LogService.verbose("TwilioBridge", "Failed to register " + roomId + " as an admin room - attempting to invite bridge user.");

            var userPromise = null;
            if (inviteTarget != null && inviteTarget !== this.getBot().getUserId()) {
                userPromise = this._getClientJoinedMembers(this.getTwilioIntent(inviteTarget, true), roomId);
            } else userPromise = this.getBot().getJoinedMembers(roomId);

            return userPromise.then(members => {
                var roomMemberIds = _.keys(members);
                if (roomMemberIds.indexOf(this.getBot().getUserId()) !== -1) return;

                var botMember = _.filter(roomMemberIds, userId => this.isTwilioUser(userId))[0];
                if (!botMember) {
                    LogService.warn("TwilioBridge", "Failed to find a join Twilio user. Could not invite bridge bot to " + roomId);
                    return;
                }

                return this.getTwilioIntent(botMember, /*raw:*/true).invite(roomId, this.getBot().getUserId());
            });
        }).catch(err => {
            LogService.error("TwilioBridge", "Error processing room " + roomId);
            LogService.error("TwilioBridge", err);
        });
    }

    /**
     * Tries to find an appropriate admin room to send the given event to. If an admin room cannot be found,
     * this will do nothing.
     * @param {MatrixEvent} event the matrix event to send to any reasonable admin room
     * @private
     */
    _tryProcessAdminEvent(event) {
        var roomId = event.room_id;
        this._adminRoomMgr.processEvent(roomId, event);
    }

    /**
     * Bridge handler for generic events
     * @private
     */
    _onEvent(request, context) {
        var event = request.getData();

        this._tryProcessAdminEvent(event);

        var returnPromise = Promise.resolve();

        if (event.type === "m.room.member" && event.content.membership === "invite" && this.isBridgeUser(event.state_key)) {
            LogService.info("TwilioBridge", event.state_key + " received invite to room " + event.room_id);
            returnPromise = this._bridge.getIntent(event.state_key).join(event.room_id).then(() => this._processRoom(event.room_id, /*isNew:*/true, /*inviteTarget:*/event.state_key));
        } else if (event.type === "m.room.message" && event.sender !== this.getBot().getUserId()) {
            returnPromise = this._processMessage(event);
        }

        return (returnPromise || Promise.resolve()).catch(err => {
            LogService.error("TwilioBridge", "Error processing event " + event.event_id + " in room " + event.room_id);
            LogService.error("TwilioBridge", err);
        })
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

    _processMessage(event) {
        if (this.isBridgeUser(event.sender)) return;
        if (this._config.bridge.allowedUsers.indexOf(event.sender) === -1) return; // not allowed - don't send

        return this.getBot().getJoinedMembers(event.room_id).then(members => {
            var roomMemberIds = _.keys(members);
            var phoneNumbers = this._getPhoneNumbers(roomMemberIds);

            for (var number of phoneNumbers) {
                this._sendSms(number, event);
            }
        });
    }

    _sendSms(phoneNumber, event) {
        LogService.verbose("TwilioBridge", "Sending text to " + phoneNumber);
        SmsProxy.send(phoneNumber, event.content.body).then(() => {
            this.getTwilioIntent(phoneNumber).sendReadReceipt(event.room_id, event.event_id);
        }).catch(error => {
            LogService.error("TwilioBridge", "Error sending message to " + phoneNumber);
            LogService.error("TwilioBridge", error);
            this.getTwilioIntent(phoneNumber).sendMessage(event.room_id, {
                msgtype: "m.notice",
                body: "Error sending text message. Please try again later."
            });
        });
    }

    _getPhoneNumbers(userIds) {
        var numbers = [];
        for (var userId of userIds) {
            if (!this.isTwilioUser(userId)) continue;

            var number = userId.substring(("@" + this._userPrefix).length).split(':')[0].trim();
            numbers.push(number);
        }

        return numbers;
    }

    _onSms(topic, event) {
        LogService.info("TwilioBridge", "Processing SMS from " + event.from + " to " + event.to);
        this.getBot().getJoinedRooms().then(rooms => {
            for (var roomId of rooms) {
                this._trySendMessage(roomId, event);
            }
        });
    }

    _trySendMessage(roomId, event) {
        this.getBot().getJoinedMembers(roomId).then(members => {
            var intent = this.getTwilioIntent(event.from);
            var memberIds = _.keys(members);

            if (memberIds.indexOf(intent.getClient().credentials.userId) === -1) return;

            LogService.info("TwilioBridge", "Sending text from " + event.from + " to " + event.to + " to room " + roomId);
            return intent.sendText(roomId, event.body);
        });
    }
}

module.exports = TwilioBridge;