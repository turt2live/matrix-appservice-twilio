var LogService = require("../LogService");

/**
 * Keeps track of who, or what, owns a phone number.
 */
class PhoneNumberManager {
    constructor() {
        this._userToPhone = {}; // { userId: phoneNumber }
        this._phoneToUsers = {}; // { phoneNumber: [userId] }

        // Direction: 780 to 587
        this._realPhoneToRooms = {}; // { phoneNumber: [roomId] }
        this._realRoomToPhone = {}; // { roomId: phoneNumber }

        // Direction: 587 to 780
        this._virtualPhoneToRooms = {}; // { phoneNumber: [roomId] }
        this._virtualRoomToPhone = {}; // { roomId: phoneNumber }
    }

    // phone, user, phoneToUsers, userToPhone
    _addRecord(single, many, singleCollection, manyCollection) {
        // userToPhone[user] = phone
        manyCollection[many] = single;

        // phoneToUsers[phone] = [users]
        if (!singleCollection[single]) singleCollection[single] = [];
        if (singleCollection[single].indexOf(many) === -1) singleCollection[single].push(many);
    }

    // phone, user, phoneToUsers, userToPhone
    _deleteRecord(single, many, singleCollection, manyCollection) {
        // delete userToPhone[userId]
        delete manyCollection[many];

        // delete phoneToUser[phoneNumber]
        var items = singleCollection[single];
        var idx = items.indexOf(many);
        if (idx !== -1) items.splice(idx, 1);
        if (items.length === 0) delete singleCollection[single];
    }

    _fixPhone(phoneNumber) {
        if (!phoneNumber.startsWith("+")) phoneNumber = "+" + phoneNumber;
        return phoneNumber;
    }

    /**
     * Adds a new phone number for a user
     * @param {string} userId the user ID
     * @param {string} phoneNumber the phone number
     */
    addUserPhoneNumber(userId, phoneNumber) {
        phoneNumber = this._fixPhone(phoneNumber);

        LogService.info("PhoneNumberManager", "Assigning " + phoneNumber + " to user " + userId);
        this._addRecord(phoneNumber, userId, this._phoneToUsers, this._userToPhone);
    }

    /**
     * Adds a new virtual phone number for a room. A virtual phone number is a phone number
     * powered by Twilio, not a real phone.
     * @param {string} roomId the room ID
     * @param {string} phoneNumber the phone number
     */
    addVirtualPhoneNumber(roomId, phoneNumber) {
        phoneNumber = this._fixPhone(phoneNumber);

        LogService.info("PhoneNumberManager", "Assigning virtual number " + phoneNumber +" to room " + roomId);
        this._addRecord(phoneNumber, roomId, this._virtualPhoneToRooms, this._virtualRoomToPhone);
    }

    /**
     * Adds a new real phone number for a room. A real phone number is a phone number that is
     * normally (or assumed to be) an actual phone, ie: not Twilio.
     * @param {string} roomId the room ID
     * @param {string} phoneNumber the phone number
     */
    addRealPhoneNumber(roomId, phoneNumber) {
        phoneNumber = this._fixPhone(phoneNumber);

        LogService.info("PhoneNumberManager", "Assigning real number " + phoneNumber +" to room " + roomId);
        this._addRecord(phoneNumber, roomId, this._realPhoneToRooms, this._realRoomToPhone);
    }

    /**
     * Deletes a phone number for a user
     * @param {string} userId the user ID
     * @param {string} phoneNumber the phone number
     */
    deleteUserPhoneNumber(userId, phoneNumber) {
        phoneNumber = this._fixPhone(phoneNumber);

        LogService.info("PhoneNumberManager", "Unassigning " + phoneNumber + " from " + userId);
        this._deleteRecord(phoneNumber, userId, this._phoneToUsers, this._userToPhone);
    }

    /**
     * Deletes a virtual phone number for a room
     * @param {string} roomId the user ID
     * @param {string} phoneNumber the phone number
     */
    deleteVirtualPhoneNumber(roomId, phoneNumber) {
        phoneNumber = this._fixPhone(phoneNumber);

        LogService.info("PhoneNumberManager", "Unassigning virtual number " + phoneNumber +" from " + roomId);
        this._deleteRecord(phoneNumber, roomId, this._virtualPhoneToRooms, this._virtualRoomToPhone);
    }

    /**
     * Deletes a real phone number for a room
     * @param {string} roomId the user ID
     * @param {string} phoneNumber the phone number
     */
    deleteRealPhoneNumber(roomId, phoneNumber) {
        phoneNumber = this._fixPhone(phoneNumber);

        LogService.info("PhoneNumberManager", "Unassigning real number " + phoneNumber +" from " + roomId);
        this._deleteRecord(phoneNumber, roomId, this._realPhoneToRooms, this._realRoomToPhone);
    }

    /**
     * Gets the user IDs that own the phone number
     * @param {string} phoneNumber the phone number
     * @returns {string[]} the users that own the phone number, or an empty array
     */
    getUserIds(phoneNumber) {
        phoneNumber = this._fixPhone(phoneNumber);

        var userIds = this._phoneToUsers[phoneNumber] || [];

        LogService.silly("PhoneNumberManager", "Get users for " + phoneNumber + " = " + userIds);
        return userIds;
    }

    /**
     * Gets the phone number a user owns
     * @param {string} userId the user ID
     * @returns {String} the phone number that is owned by the user, or a falsey value if none
     */
    getUserPhoneNumber(userId) {
        var phoneNumber = this._userToPhone[userId];

        LogService.silly("PhoneNumberManager", "Get phone for " + userId + " = " + (phoneNumber ? phoneNumber : "<NONE>"));
        return phoneNumber;
    }

    /**
     * Gets the room IDs that own the virtual phone number
     * @param {string} phoneNumber the phone number
     * @returns {string[]} the rooms that own the phone number, or an empty array
     */
    getVirtualRoomIds(phoneNumber) {
        phoneNumber = this._fixPhone(phoneNumber);

        var roomIds = this._virtualPhoneToRooms[phoneNumber] || [];

        LogService.silly("PhoneNumberManager", "Get virtual rooms for " + phoneNumber + " = " + roomIds);
        return roomIds;
    }

    /**
     * Gets the virtual phone number for a room
     * @param {string} roomId the room ID
     * @returns {String} the phone number, or a falsey value if none
     */
    getVirtualPhoneNumber(roomId) {
        var phoneNumber = this._virtualRoomToPhone[roomId];

        LogService.silly("PhoneNumberManager", "Get virtual phone for " + roomId + " = " + (phoneNumber ? phoneNumber : "<NONE>"));
        return phoneNumber;
    }

    /**
     * Gets the room IDs that own the real phone number
     * @param {string} phoneNumber the phone number
     * @returns {string[]} the rooms that own the phone number, or an empty array
     */
    getRealRoomIds(phoneNumber) {
        phoneNumber = this._fixPhone(phoneNumber);

        var roomIds = this._realPhoneToRooms[phoneNumber] || [];

        LogService.silly("PhoneNumberManager", "Get real rooms for " + phoneNumber + " = " + roomIds);
        return roomIds;
    }

    /**
     * Gets the real phone number for a room
     * @param {string} roomId the room ID
     * @returns {String} the phone number, or a falsey value if none
     */
    getRealPhoneNumber(roomId) {
        var phoneNumber = this._realRoomToPhone[roomId];

        LogService.silly("PhoneNumberManager", "Get real phone for " + roomId + " = " + (phoneNumber ? phoneNumber : "<NONE>"));
        return phoneNumber;
    }
}

module.exports = new PhoneNumberManager();