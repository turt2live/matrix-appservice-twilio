var LogService = require("../LogService");
var PubSub = require("pubsub-js");
var PhoneNumberCache = require("./PhoneNumberCache");
var Promise = require("bluebird");

/**
 * Handles incoming SMS from Twilio and sends it to Matrix
 */
class SmsReceiver {
    constructor() {
        PubSub.subscribe("sms_recv", this._onSms.bind(this));
    }

    /**
     * Sets the bridge to use in this receiver
     * @param {TwilioBridge} bridge the bridge to use
     */
    setBridge(bridge) {
        this._bridge = bridge;
    }

    _onSms(topic, event) {
        LogService.info("SmsReceiver", "Processing SMS from " + event.from + " to " + event.to);
        var intent = this._bridge.getTwilioIntent(event.from);

        var numberRegistration = PhoneNumberCache.getNumberRegistration(event.to);
        if (!numberRegistration) {
            LogService.warn("SmsReceiver", "Phone number " + event.to + " is not registered");
            return;
        }

        var roomPromise = Promise.resolve([]);
        if (numberRegistration.type === "user") {
            var rooms = PhoneNumberCache.findUserRooms(event.from, event.to);
            if (rooms.length === 0) {
                roomPromise = this._bridge.createDirectChat(event.from, numberRegistration.ownerId).then(roomId => [roomId]);
            } else roomPromise = Promise.resolve(rooms);
        } else if (numberRegistration === "room") {
            var roomId = PhoneNumberCache.findRoom(event.to);
            roomPromise = Promise.resolve([roomId]);
        } else {
            LogService.warn("SmsReceiver", "Phone number " + event.to + " has unknown type " + numberRegistration.type + " (owned by " + numberRegistration.ownerId + ")");
            return;
        }

        roomPromise.then(rooms => {
            if (rooms.length === 0) {
                LogService.warn("SmsReceiver", "Message from " + event.from + " to " + event.to + " (" + numberRegistration.type + " number owned by " + numberRegistration.ownerId + ") did not route to any rooms");
                return;
            }

            for (var roomId of rooms) {
                LogService.info("SmsReceiver", "Sending text from " + event.from + " to " + event.to + " to room " + roomId);
                intent.sendText(roomId, event.body);
            }
        }).catch(err => {
            LogService.error("SmsReceiver", "Failed to get rooms for " + event.from + " to " + event.to + " owned by " + numberRegistration.ownerId);
            LogService.error("SmsReceiver", err);
        });
    }
}

module.exports = new SmsReceiver();