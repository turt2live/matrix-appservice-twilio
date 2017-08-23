var Bridge = require("matrix-appservice-bridge").Bridge;
var LogService = require("./LogService");
var AdminRoom = require("./matrix/AdminRoom");
var SmsStore = require("./storage/TwilioStore");
var Promise = require('bluebird');
var _ = require('lodash');
var util = require("./utils");
var SmsProxy = require("./twilio/SmsProxy");
var RemoteUser = require("matrix-appservice-bridge").RemoteUser;

class TwilioBridge {
    constructor(config, registration) {
        LogService.info("TwilioBridge", "Constructing bridge");

        this._config = config;
        this._registration = registration;
        this._adminRooms = {}; // { roomId: AdminRoom }

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
     * @return {Intent} the virtual user intent
     */
    getSmsIntent(phoneNumber) {
        return this._bridge.getIntentFromLocalpart("_sms_" + phoneNumber);
    }

    /**
     * Determines if the given user ID is a bridged user
     * @param {string} handle the matrix user ID to check
     * @returns {boolean} true if the user ID is a bridged user, false otherwise
     */
    isBridgeUser(handle) {
        return this.getBot().getUserId() == handle || (handle.startsWith("@_sms_") && handle.endsWith(":" + this._config.homeserver.domain));
    }

    getOrCreateAdminRoom(userId) {
        var roomIds = _.keys(this._adminRooms);
        for (var roomId of roomIds) {
            if (!this._adminRooms[roomId]) continue;
            if (this._adminRooms[roomId].owner === userId)
                return Promise.resolve(this._adminRooms[roomId]);
        }

        return this.getBotIntent().createRoom({
            createAsClient: false, // use bot
            options: {
                invite: [userId],
                is_direct: true,
                preset: "trusted_private_chat",
                visibility: "private",
                initial_state: [{content: {guest_access: "can_join"}, type: "m.room.guest_access", state_key: ""}]
            }
        }).then(room => {
            var newRoomId = room.room_id;
            return this._processRoom(newRoomId, /*adminRoomOwner=*/userId).then(() => {
                var room = this._adminRooms[newRoomId];
                if (!room) throw new Error("Could not create admin room for " + userId);
                return room;
            });
        });
    }

    /**
     * Destroys an admin room. This will not cause the bridge bot to leave. It will simply de-categorize it.
     * The room may be unintentionally restored when the bridge restarts, depending on the room conditions.
     * @param {string} roomId the room ID to destroy
     */
    removeAdminRoom(roomId) {
        this._adminRooms[roomId] = null;
    }

    /**
     * Updates the bridge bot's appearance in matrix
     * @private
     */
    _updateBotProfile() {
        LogService.info("TwilioBridge", "Updating appearance of bridge bot");

        var desiredDisplayName = this._config.smsBot.appearance.displayName || "SMS Bridge";
        var desiredAvatarUrl = this._config.smsBot.appearance.avatarUrl || "https://t2bot.io/_matrix/media/v1/download/t2l.io/SOZlqpJCUoecxNFZGGnDEhEy"; // sms icon

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
     * @param {String} [adminRoomOwner] the owner of the admin room. If provided, the room will be forced as an admin room
     * @param {boolean} [newRoom] if true, this indicates to the parser that the room is new and not part of a startup routine.
     * @return {Promise<>} resolves when processing is complete
     * @private
     */
    _processRoom(roomId, adminRoomOwner = null, newRoom = false) {
        LogService.info("TwilioBridge", "Request to bridge room " + roomId);
        return this.getBot().getJoinedMembers(roomId).then(members => {
            var roomMemberIds = _.keys(members);
            var botIdx = roomMemberIds.indexOf(this._bridge.getBot().getUserId());

            if (roomMemberIds.length == 2 || adminRoomOwner) {
                var otherUserId = roomMemberIds[botIdx == 0 ? 1 : 0];
                this._adminRooms[roomId] = new AdminRoom(roomId, this, otherUserId || adminRoomOwner);
                LogService.verbose("TwilioBridge", "Added admin room for user " + (otherUserId || adminRoomOwner));

                if (newRoom) {
                    this.getBotIntent().sendText(roomId, "Hello! This room can be used to manage various aspects of the bridge. Although this currently doesn't do anything, it will be more active in the future.");
                }
            } // else it is just a regular room

            // TODO: If @_sms_* is in a room but no bridge bot, then invite the bot & complain if we can't do the invite.
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

        if (this._adminRooms[roomId]) this._adminRooms[roomId].handleEvent(event);
    }

    /**
     * Bridge handler for generic events
     * @private
     */
    _onEvent(request, context) {
        var event = request.getData();

        this._tryProcessAdminEvent(event);

        if (event.type === "m.room.member" && event.content.membership === "invite" && this.isBridgeUser(event.state_key)) {
            LogService.info("TwilioBridge", event.state_key + " received invite to room " + event.room_id);
            return this._bridge.getIntent(event.state_key).join(event.room_id).then(() => this._processRoom(event.room_id, /*owner:*/null, /*newRoom:*/true));
        } else if (event.type === "m.room.message" && event.sender !== this.getBot().getUserId()) {
            return this._processMessage(event);
        }

        // Default
        return Promise.resolve();
    }

    /**
     * Bridge handler to update/create user information
     * @private
     */
    _onUserQuery(matrixUser) {
        var handle = matrixUser.localpart.substring('_sms_'.length);
        if (handle.startsWith("+")) handle = handle.substring(1);
        return Promise.resolve({
            name: "+" + handle + " (SMS)",
            remote: new RemoteUser(matrixUser.localpart)
        });
    }

    _processMessage(event) {
        if (this.isBridgeUser(event.sender)) return;
        if (this._config.TwilioBridge.allowedUsers.indexOf(event.sender) === -1) return; // not allowed - don't send

        this.getBot().getJoinedMembers(event.room_id).then(members => {
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
            this.getSmsIntent(phoneNumber).sendReadReceipt(event.room_id, event.event_id);
        }).catch(error => {
            LogService.error("TwilioBridge", "Error sending message to " + phoneNumber);
            LogService.error("TwilioBridge", error);
            this.getSmsIntent(phoneNumber).sendMessage(event.room_id, {
                msgtype: "m.notice",
                body: "Error sending text message. Please try again later."
            });
        });
    }

    _getPhoneNumbers(userIds) {
        var numbers = [];
        for (var userId of userIds) {
            if (!this.isBridgeUser(userId)) continue;
            if (!userId.startsWith("@_sms_")) continue;

            var number = userId.substring("@_sms_".length).split(':')[0].trim();
            numbers.push(number);
        }

        return numbers;
    }
}

module.exports = TwilioBridge;