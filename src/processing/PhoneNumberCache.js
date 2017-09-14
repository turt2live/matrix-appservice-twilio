var LogService = require("../LogService");
var _ = require("lodash");

/**
 * Caches information about phone numbers
 */
class PhoneNumberCache {
    constructor() {
        this._userNumbers = {}; // { toNumber: { fromNumber: [roomIds] } }
        this._roomNumbers = {}; // { toNumber: roomId }
        this._numberTypes = {}; // { number: {type:, ownerId:} }
        this._roomOwnedNumbers = {}; // { roomId: number }
        this._ownedNumbers = {}; // { ownerId: number }
    }

    /**
     * Registers a number with the cache. This will overwrite any previous mappings.
     * @param {string} number the phone number
     * @param {'user'|'room'} type the number type
     * @param {string} ownerId the owner of the number, such as a room ID or user ID
     */
    registerNumber(number, type, ownerId) {
        if (type !== "user" && type !== "room") throw new Error("Type must be 'user' or 'room', got '" + type + "'");

        LogService.info("PhoneNumberCache", "Setting " + number + " to be a " + type + " number owned by " + ownerId);
        this._numberTypes[number] = {
            type: type,
            ownerId: ownerId
        };
        this._ownedNumbers[ownerId] = number;
    }

    /**
     * Gets the phone number for a given owner. The owner is anything that was registered as
     * an owner in a previous call.
     * @param {string} ownerId the owner ID, such as a user ID or room ID
     * @returns {String} the phone number, or a falsey value
     */
    getNumberForOwner(ownerId) {
        return this._ownedNumbers[ownerId];
    }

    /**
     * Gets the last known registration for a number.
     * @param {string} number the phone number to look up
     * @returns {{type:string,ownerId:string}} the registration for the number, or a falsey value
     */
    getNumberRegistration(number) {
        var obj = this._numberTypes[number];
        if (obj) return _.clone(obj);
        return null;
    }

    /**
     * Gets the type of number that is registered
     * @param {string} number the registered number
     * @returns {String} the type of number, such as 'user' or 'room', or a falsey value for 'not registered'
     */
    getNumberType(number) {
        var registration = this.getNumberRegistration(number);
        if (registration) return registration.type;
        return null;
    }

    /**
     * Adds a new user phone number mapping. This is a 1:1 conversation between two
     * phone numbers, one of which likely being a bridged user. Multiple rooms may
     * be linked by calling this multiple times.
     * @param {string} fromNumber the external, or third party, phone number
     * @param {string} toNumber the internal, or aliased, phone number (matrix user)
     * @param {string} roomId the room ID to map this connection to
     */
    addUserNumber(fromNumber, toNumber, roomId) {
        if (this.getNumberType(toNumber) !== 'user') throw new Error("Phone number " + toNumber + " is not a user number.");

        if (!this._userNumbers[toNumber]) this._userNumbers[toNumber] = {};
        if (!this._userNumbers[toNumber][fromNumber]) this._userNumbers[toNumber][fromNumber] = [];

        var idx = this._userNumbers[toNumber][fromNumber].indexOf(roomId);
        if (idx === -1) {
            LogService.info("PhoneNumberCache", "Mapped user phone number " + toNumber + " with external " + fromNumber + " as room " + roomId);
            this._userNumbers[toNumber][fromNumber].push(roomId);
        } else {
            LogService.warn("PhoneNumberCache", "User phone number mapping of " + toNumber + " with external " + fromNumber + " as room " + roomId + " already exists");
        }

        this._roomOwnedNumbers[roomId] = toNumber;
    }

    /**
     * Adds a new phone number for a room. This is generally used for multi-user chats
     * where the entire room has a phone number, and all messages are sent through that.
     * If a mapping for this phone number already exists, it will be overwritten.
     * @param {string} toNumber the phone number of the room
     * @param {string} roomId the room ID
     */
    addRoomNumber(toNumber, roomId) {
        if (this.getNumberType(toNumber) !== 'room') throw new Error("Phone number " + toNumber + " is not a room number.");

        var existingRoomId = this._roomNumbers[toNumber];
        if (existingRoomId) LogService.warn("PhoneNumberCache", "Overwriting room phone number " + toNumber + " from room " + existingRoomId + " to room " + roomId);
        this._roomNumbers[toNumber] = roomId;

        this._roomOwnedNumbers[toNumber] = roomId;
    }

    /**
     * Finds all of the rooms that match the specified sender and receiver. This will only
     * return rooms that fit the 'user' classification (1:1 chats).
     * @param {string} fromNumber the phone number that sent the message (external)
     * @param {string} toNumber the phone number receiving the message (internal)
     * @returns {string[]} the room IDs that match, or an empty array
     */
    findUserRooms(fromNumber, toNumber) {
        if (!this._userNumbers[toNumber]) return [];
        if (!this._userNumbers[toNumber][fromNumber]) return [];
        return _.clone(this._userNumbers[toNumber][fromNumber]);
    }

    /**
     * Finds the room ID that owns the given phone number. This will only look at records
     * that match the 'room' classification (multi-user chats).
     * @param {string} toNumber the phone number receiving the message (internal)
     * @returns {string} the room ID that matches, or a falsey value
     */
    findRoom(toNumber) {
        return this._roomNumbers[toNumber];
    }

    /**
     * Gets the phone number that represents a room. In a user room, this would be the number
     * of the matrix user. In a multi-user chat, this would be the number of the room.
     * @param {string} number the number
     * @returns {String} the room's number, or a falsey value
     */
    getNumberForRoom(number) {
        return this._roomOwnedNumbers[number];
    }
}

module.exports = new PhoneNumberCache();