var AdminRoom = require("./AdminRoom");
var Promise = require('bluebird');
var LogService = require("../LogService");
var _ = require("lodash");

/**
 * Manages admin rooms for users of the bridge.
 */
class AdminRoomManager {

    /**
     * Creates a new Admin Room Manager
     * @param {TwilioBridge} twilioBridge the bridge instance
     */
    constructor(twilioBridge) {
        this._bridge = twilioBridge;

        this._adminRooms = {}; // { roomId: AdminRoom }
        this._adminRoomsByOwner = {}; // { owner: [roomIds] }
    }

    _addAdminRoom(roomInstance) {
        LogService.verbose("AdminRoomManager", "Registering admin room " + roomInstance.roomId + " with owner " + roomInstance.owner);
        if (!this._adminRoomsByOwner[roomInstance.owner])
            this._adminRoomsByOwner[roomInstance.owner] = [];

        this._adminRooms[roomInstance.roomId] = roomInstance;
        this._adminRoomsByOwner[roomInstance.owner].push(roomInstance.roomId);
    }

    getOrCreateAdminRoom(userId) {
        if (this._adminRoomsByOwner[userId] && this._adminRoomsByOwner[userId].length > 0) {
            var existingRoom = this._adminRoomsByOwner[userId][0];
            LogService.verbose("AdminRoomManager", "User " + userId + " already has an admin room - returning room " + existingRoom.roomId);
            return Promise.resolve(existingRoom);
        }

        LogService.verbose("AdminRoomManager", "Admin room create request for user " + userId);
        return this._bridge.getBotIntent().createRoom({
            createAsClient: false, // use bot
            options: {
                invite: [userId],
                is_direct: true,
                preset: "trusted_private_chat",
                visibility: "private",
                initial_state: [{content: {guest_access: "can_join"}, type: "m.room.guest_access", state_key: ""}]
            }
        }).then(room => {
            LogService.verbose("AdminRoomManager", "User " + userId + " now has an admin room: " + room.room_id);
            this._sendWelcome(room.room_id);

            var adminRoom = new AdminRoom(room.room_id, this._bridge, userId);
            this._addAdminRoom(adminRoom);

            return adminRoom;
        });
    }

    _sendWelcome(roomId) {
        LogService.verbose("AdminRoomManager", "Sending welcome message to " + roomId);
        this._bridge.getBotIntent().sendMessage(roomId, {
            msgtype: "m.notice",
            body: "Hello! This room can be used to manage various aspects of the bridge. Although this currently doesn't do anything, it will be more active in the future."
        });
    }

    removeAdminRoom(roomId) {
        LogService.verbose("AdminRoomManager", "Deleting admin room " + roomId);
        this._adminRooms[roomId] = null;

        var users = _.keys(this._adminRoomsByOwner);
        for (var user of users) {
            var idx = 0;
            while ((idx = this._adminRoomsByOwner[user].indexOf(roomId)) !== -1) {
                this._adminRoomsByOwner[user].splice(idx, 1);
            }
        }
    }

    tryAddAdminRoom(roomId, isNew = false) {
        LogService.verbose("AdminRoomManager", "Checking viability of room " + roomId);
        return this._bridge.getBot().getJoinedMembers(roomId).then(members => {
            var roomMemberIds = _.keys(members);
            var botIdx = roomMemberIds.indexOf(this._bridge.getBot().getUserId());

            if (roomMemberIds.length == 2 && botIdx !== -1) {
                var otherUserId = roomMemberIds[botIdx == 0 ? 1 : 0];
                this._addAdminRoom(new AdminRoom(roomId, this._bridge, otherUserId));

                if (isNew) {
                    this._sendWelcome(roomId);
                }

                LogService.verbose("AdminRoomManager", "Room " + roomId + " is viable as an admin room for " + otherUserId + " (registered)");
                return Promise.resolve();
            }

            LogService.verbose("AdminRoomManager", "Room " + roomId + " is not viable as an admin room");
            return Promise.reject();
        }).catch(() => Promise.reject());
    }

    processEvent(roomId, event) {
        if (!this._adminRooms[roomId]) return;

        this._adminRooms[roomId].handleEvent(event);
    }

}

module.exports = AdminRoomManager;