# Multi-user chats (MUC)

A standard "1:1 chat" for the bridge involves three users: The Matrix user, the phone number virtual user, and the bridge bot. Rooms containing anything more than those 3 users (including more matrix users or more virtual users) are multi-user chats.

## Feature Overview/Rules

* A control number must be used for signaling (this is the owner's phone number when in single user mode)
* The receiver (virtual user) must always be asked if they want to receive messages from the room.
  * Ie: `@travis:t2l.io wants you to chat in #matrix:matrix.org with 8000 other people. Reply ALLOW or DENY to respond.`
* The receiver (virtual user) can opt-out at any time by sending a message to the control number. Eg: `EXIT` or `OPTOUT`
* The bridge operator can disable MUC support through the configuration
  * This would mean any virtual users in a MUC just don't see anything, and nothing gets forwarded back to Matrix.

## Setting up a MUC as a user (single user or provider)

1. Create an empty room
2. Invite whoever you like, virtual or otherwise
3. The bridge bot will automatically be invited by one of the virtual users
4. The bridge bot will say "To purchase a number for this room, say !purchase". Say "!purchase"
   1. If you are running in single user mode, this will only work if you are the owner
   2. This will start the dance of registering a number
5. Once a phone number is purchased for the room, all chat communications will go through that

## Participating in a MUC as a phone user

1. Send a text to the room's phone number
2. If the room is set to invite-only and you are not in the room, you'll receive a notice that your message wasn't sent.

## Considerations

* Don't spam rejection notices. This is to save money. 