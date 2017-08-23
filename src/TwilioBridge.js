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

class TwilioBridge {
    constructor(config, registration) {
        LogService.info("TwilioBridge", "Constructing bridge");

        this._config = config;
        this._registration = registration;
        this._adminRoomMgr = new AdminRoomManager(this);

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
    getTwilioIntent(phoneNumber) {
        if (phoneNumber.startsWith("+")) phoneNumber = phoneNumber.substring(1);
        return this._bridge.getIntentFromLocalpart("_sms_" + phoneNumber);
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
        return handle.startsWith("@_twilio_") && handle.endsWith(":"+this._config.homeserver.domain);
    }

    /**
     * Updates the bridge bot's appearance in matrix
     * @private
     */
    _updateBotProfile() {
        LogService.info("TwilioBridge", "Updating appearance of bridge bot");

        var desiredDisplayName = this._config.bot.appearance.displayName || "SMS Bridge";
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
        if (this._config.bridge.allowedUsers.indexOf(event.sender) === -1) return; // not allowed - don't send

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
            if (!this.isBridgeUser(userId)) continue;
            if (!userId.startsWith("@_sms_")) continue;

            var number = userId.substring("@_sms_".length).split(':')[0].trim();
            numbers.push(number);
        }

        return numbers;
    }
}

module.exports = TwilioBridge;