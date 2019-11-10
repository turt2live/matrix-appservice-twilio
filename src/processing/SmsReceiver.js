var LogService = require("../LogService");
var PubSub = require("pubsub-js");
var PhoneNumberCache = require("./PhoneNumberCache");
var Promise = require("bluebird");
var util = require("../utils");

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

            if (event.media != null){
                // TODO: handle anything in the event.body also...maybe just always do the sendText() also?
                var mxcUrls = [];
                var promises = [];
                for (var mediaOne of event.media) {
                    promises.push(this._uploadMedia(mediaOne, mxcUrls, intent));
                }
    
                Promise.all(promises).then(() => {
                    for (var roomId of rooms) {
                        this._postMedia(roomId, mxcUrls, intent);
                    }
                });
                
            }
            // Handle any text now (even if we handled media above), but skip if message is ""
            if (event.body.length > 0) {
                for (var roomId of rooms) {
                    LogService.info("SmsReceiver", "Sending text from " + event.from + " to " + event.to + " to room " + roomId);
                    intent.sendText(roomId, event.body);
                }
        }

        }).catch(err => {
            LogService.error("SmsReceiver", "Failed to get rooms for " + event.from + " to " + event.to + " owned by " + numberRegistration.ownerId);
            LogService.error("SmsReceiver", err);
        });
    }

    _uploadMedia(media, mxcUrls, intent) {
        return util.uploadContentFromUrl(this._bridge, media.url, intent)
            .then(mxcUrl => mxcUrls.push({url: media.url, contentType: media.contentType, mxc: mxcUrl}));
    }

    /**
     * Posts media to a given matrix room
     * @param {string} roomId the matrix room ID
     * @param {string} content the media content
     * @param {Intent} intent the intent to post as
     * @private
     */
    _postMedia(roomId, content, intent) {
        var contentPromises = [];
        var eventIds = [];
        for (var media of content) {
            var body = {
                url: media.mxc,  
                body: "MMS",
                info: {
                    mimetype: media.contentType
                }, 
                external_url: media.url 
            };

            // TODO: Should to handle at least the twillio fully supported mime types, plus VCARD
            // This is approximately the LEAST we can do...
            if (media.contentType.startsWith("video/")) {
                body['msgtype'] = 'm.video';
            } else if (media.contentType.startsWith("image/"))  {
                body['msgtype'] = 'm.image';
            } else {
                body['msgtype'] = 'm.file';
            }

            contentPromises.push(intent.sendMessage(roomId, body));
 
        }

        Promise.all(contentPromises).then(() => {
            return Promise.resolve();
        });
    }

}

module.exports = new SmsReceiver();