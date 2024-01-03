import express from 'express'
import { Server } from "socket.io"
import path from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'
import { Socket } from 'dgram'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PORT = process.env.PORT || 3500
const ADMIN = "Admin"

const app = express()

app.use(express.static(path.join(__dirname, "public")))

const expressServer = app.listen(PORT, () => {
    console.log(`listening on port ${PORT}`)
})

// state 
const UsersState = {
    users: [],
    setUsers: function (newUsersArray) {
        this.users = newUsersArray
    }
}

const io = new Server(expressServer, {
    cors: {
        origin: process.env.NODE_ENV === "production" ? false : ["http://localhost:5500", "http://127.0.0.1:5500"]
    }
})

io.on('connection', socket => {
    console.log(`User ${socket.id} connected`)

    // Upon connection - only to user 
    socket.emit('message', buildMsg(ADMIN, "Welcome to Chat App!"))
    socket.on('enterRoom',  async ({ name, room }) => {
        
        // leave previous room 
        const prevRoom = getUser(socket.id)?.room

        if (prevRoom) {
            socket.leave(prevRoom)
            io.to(prevRoom).emit('message', buildMsg(ADMIN, `${name} has left the room`))
        }

        let {user,key} = await activateUser(socket.id, name, room,socket);
        // Cannot update previous room users list until after the state update in activate user 
        if (prevRoom) {
            io.to(prevRoom).emit('userList', {
                users: getUsersInRoom(prevRoom)
            })
        }

        //send private key to user
        socket.emit('pkey',await exportCryptoKey(key));
        function ab2str(buf) {
            return String.fromCharCode.apply(null, new Uint8Array(buf));
        }
        async function exportCryptoKey(key) {
            const exported = await crypto.subtle.exportKey("pkcs8", key);
            const exportedAsString = ab2str(exported);
            const exportedAsBase64 = btoa(exportedAsString);
            const pemExported = `-----BEGIN PRIVATE KEY-----\n${exportedAsBase64}\n-----END PRIVATE KEY-----`;
            return pemExported;
        }
        
        if(getAllActiveRooms().length>0){
            if(user.room===getAllActiveRooms()[0]){
                // join room 
                socket.join(user.room)
            }
            else{
                return;
            }
        }
        else{
            // join room 
            socket.join(user.room)
        }
        

        // To user who joined 
        socket.emit('message', buildMsg(ADMIN, `You have joined the ${user.room} chat room`))

        // To everyone else 
        socket.broadcast.to(user.room).emit('message', buildMsg(ADMIN, `${user.name} has joined the room`))

        // Update user list for room 
        io.to(user.room).emit('userList', {
            users: getUsersInRoom(user.room)
        })

        // Update rooms list for everyone 
        io.emit('roomList', {
            rooms: getAllActiveRooms()
        })
        user,key=null;
    })

    // When user disconnects - to all others 
    socket.on('disconnect', () => {
        const user = getUser(socket.id)
        userLeavesApp(socket.id)

        if (user) {
            io.to(user.room).emit('message', buildMsg(ADMIN, `${user.name} has left the room`))

            io.to(user.room).emit('userList', {
                users: getUsersInRoom(user.room)
            })

            io.emit('roomList', {
                rooms: getAllActiveRooms()
            })
        }

        console.log(`User ${socket.id} disconnected`)
    })

    // Listening for a message event from users
    socket.on('encmessage', async ({ name, text }) => {
        const room = getUser(socket.id)?.room
        const recKey=getRecipient(socket.id)?.publicKey;
        const msg= await buildMsgEnc(name, text,recKey);
        const dataString= JSON.stringify(Array.from(new Uint8Array(msg.text)));
        if (room) {
            io.to(room).emit('encmessage', {
                name: msg.name,
                text: dataString,
                time: msg.time
            });
        }
    })

    // Listen for activity 
    socket.on('activity', (name) => {
        const room = getUser(socket.id)?.room
        if (room) {
            socket.broadcast.to(room).emit('activity', name)
        }
    })
})

function buildMsg(name, text) {
    return {
        name,
        text,
        time: new Intl.DateTimeFormat('default', {
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric'
        }).format(new Date())
    }
}

async function buildMsgEnc(name, msg,key) {
    let text= await encryptMessage(key,msg);
    return {
        name,
        text,
        time: new Intl.DateTimeFormat('default', {
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric'
        }).format(new Date())
    }
}

// User functions 
async function activateUser(id, name, room) {
    const res=crypto.subtle.generateKey(
        {
            name: "RSA-OAEP",
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: "SHA-256",       
        },true,["encrypt", "decrypt"]
    ).then((keyPair) => {
        const publicKey=keyPair.publicKey;
        const privateKey=keyPair.privateKey;
        
        const user = { id, name, room, publicKey}
        UsersState.setUsers([
            ...UsersState.users.filter(user => user.id !== id),
            user
        ])
        return {
            user: user,
            key: privateKey
        };
    });
    return await res;
}

function userLeavesApp(id) {
    UsersState.setUsers(
        UsersState.users.filter(user => user.id !== id)
    )
}

function getUser(id) {
    return UsersState.users.find(user => user.id === id)
}

function getRecipient(id){
    return UsersState.users.find(user => user.id !== id)
}

function getUsersInRoom(room) {
    return UsersState.users.filter(user => user.room === room)
}

function getAllActiveRooms() {
    return Array.from(new Set(UsersState.users.map(user => user.room)))
}

async function encryptMessage(key,message) {
    let enc = new TextEncoder();
    let encoded = enc.encode(message);
    let ciphertext = await crypto.subtle.encrypt(
      {
        name: "RSA-OAEP"
      },
      key,
      encoded
    );
    return ciphertext;
  }