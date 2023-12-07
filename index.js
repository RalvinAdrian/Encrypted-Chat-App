import express from 'express'
import { Server } from "socket.io"
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PORT = process.env.PORT || 3500
const ADMIN = "Admin"
const app = express()
app.use(express.static(path.join(__dirname, "public")))

const expressServer = app.listen(PORT, () => {
    console.log(`listening on port ${PORT}`)
})

const io = new Server(expressServer, {
    cors: {
        origin: process.env.NODE_ENV === "production" ? false : ["http://localhost:5500", "http://127.0.0.1:5500"]
    }
})
// state 
const UsersState = {
    users: [],
    setUsers: function (newUsersArray) {
        this.users = newUsersArray
    }
}

io.on('connection', socket => {
    console.log(`User ${socket.id} connected`);

    socket.on('login', (data) => {
        const { name, room, password } = data;

        // Perform authentication here (e.g., check against a user list)
        // For simplicity, you can use a hardcoded list of users in this example
        const isAuthenticated = checkUserAuthentication(name, password);

        if (!isAuthenticated) {
            socket.emit('loginError', 'Authentication failed. Please check your credentials.');
            return;
        }

        const user = activateUser(socket.id, name, room);

        socket.join(user.room);

        socket.emit('message', buildMsg('Admin', `Welcome to ${user.room}.`));
        socket.broadcast.to(user.room).emit('message', buildMsg('Admin', `${user.name} has joined.`));

        io.to(user.room).emit('userList', {
            users: getUsersInRoom(user.room)
        });

        io.emit('roomList', {
            rooms: getAllActiveRooms()
        });
    });

    // When user disconnects - to all others 
    socket.on('disconnect', () => {
        const user = getUser(socket.id);
        userLeavesApp(socket.id);

        if (user) {
            io.to(user.room).emit('message', buildMsg('Admin', `${user.name} has left the chat.`));
            io.to(user.room).emit('userList', {
                users: getUsersInRoom(user.room)
            });
        }

        console.log(`User ${socket.id} has left the chat.`);
    });

    // Listening for a message event 
    socket.on('message', ({ name, text }) => {
        const room = getUser(socket.id)?.room;
        if (room) {
            io.to(room).emit('message', buildMsg(name, text));
        }
    });
});
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

// User functions 
function activateUser(id, name, room) {
    const user = { id, name, room };
    UsersState.setUsers([
        ...UsersState.users.filter(user => user.id !== id),
        user
    ]);
    return user;
}

function userLeavesApp(id) {
    UsersState.setUsers(
        UsersState.users.filter(user => user.id !== id)
    )
}

function getUser(id) {
    return UsersState.users.find(user => user.id === id)
}

function checkUserAuthentication(name, password) {
    const users = {
        'user1': '1234',
        'user2': '1234',
        'user3': '1234',
        'user4': '1234',
    };

    return users[name] && users[name] === password;
}
