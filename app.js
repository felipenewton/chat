var express = require('express');
var session = require('express-session');
var path = require('path');
var sassMiddleware = require('node-sass-middleware');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var Room = require('./room.js');
var app = express();

var port = process.env.PORT || 3000;

var io = require('socket.io').listen(app.listen(port));
var rooms = {};

var sessionMiddleware = session({
  name: 'jchat_session',
  secret: 'secret',
  cookie: {maxAge: null},
  resave: true,
  saveUninitialized: true
});

//configure app
app.set('view engine', 'jade');
app.set('views', path.join(__dirname, 'views'));
app.use(
  sassMiddleware({
    src: __dirname + '/sass',
    dest: __dirname + '/public/stylesheets',
    outputStyle: 'compressed',
    prefix:  '/stylesheets'
  })
);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(sessionMiddleware);

io.use(function(socket, next){
  sessionMiddleware(socket.request, socket.request.res, next);
});

/* SESSION INFO */
// username: stored as string
// userRooms: object, key = name, val = id
// previousRooms: array of userRooms keys (before adding new)

var all = new Room('Lobby', 'lobby');
rooms['lobby'] = all;
var userJoined = false;


/* ROUTES */
app.get('/', function(req, res){
  console.log('');
  if (!req.session.previousRooms) {
    req.session.previousRooms = [];
  }
  if (!req.session.userRooms) {
    req.session.userRooms = {};
  }
  //set previous rooms to user rooms before adding new room to list
  req.session.previousRooms = Object.keys(req.session.userRooms);
  console.log('PREVIOUS ROOMS BEFORE ADDING: ' + req.session.previousRooms);
  if (!req.session.userRooms['Lobby']) {
    req.session.userRooms['Lobby'] = 'lobby';
  }

  console.log('PREVIOUS ROOMS AFTER ADDING: ' + req.session.previousRooms);
  res.render('global_chat', {private: false});
});

app.get('/chats/:id', function(req, res){
  console.log('');
  var id = req.params.id;
  if (!req.session.previousRooms) {
    req.session.previousRooms = [];
  }
  if (!req.session.userRooms) {
    req.session.userRooms = {};
  }
  if (rooms[id]) {
    req.session.previousRooms = Object.keys(req.session.userRooms);
    console.log('GET PREVIOUS ROOMS BEFORE ADDING: ' + req.session.previousRooms);
    var name = rooms[id].name;
    req.session.userRooms[name] = id;
    console.log('GET PREVIOUS ROOMS AFTER ADDING: ' + req.session.previousRooms);
  }
  console.log(JSON.stringify(req.session.userRooms));
  res.render('global_chat', {private: true});
});

app.post('/submitUsername', function(req, res){
  req.session.username = req.body.name;
  res.send(req.body);
});

app.post('/submitRoom', function(req, res){
  rooms[req.body.roomId] = new Room(req.body.roomName, req.body.roomId);
  res.send(req.body);
});

app.delete('/deleteRoom', function(req, res){
  var toDelete = req.body.roomName;
  var id = req.session.userRooms[toDelete];
  var room = rooms[id];
  if (room) {
    --room.numReferences;
    console.log('Num references for ' + toDelete + ' after deletion: ' + rooms[req.session.userRooms[toDelete]].numReferences);
  }
  var index = req.session.previousRooms.indexOf(toDelete);
  if (index != -1) {
    req.session.previousRooms.splice(index, 1);
  }
  delete req.session.userRooms[toDelete];

  //delete room from system of 0 users and 0 references
  if (rooms[id].numUsers === 0) {
    if (rooms[id].numReferences == 0) {
      delete rooms[id];
      console.log('DELETED FROM SYSTEM');
    } else {
      console.log('STILL REFERENCES TO ROOM: ' + rooms[roomId].numReferences);
    }
  } else {
    console.log('SOMEONE STILL USING ROOM');
  }
  console.log('Rooms after removal of room: ' + JSON.stringify(req.session.userRooms));


  res.send(req.body);
});

/* CHAT SOCKET */

io.sockets.on('connection', function(socket){
  var username = socket.request.session.username;

  //check if room at incoming request exists
  socket.on('load', function(roomId) {
    //set socket room id to path given
    socket.room = roomId;

    var roomName = null;
    if (rooms[roomId]) {
      var roomName = rooms[roomId].name;
      checkSession(socket, roomId, roomName);
    } else {
      socket.emit('page does not exist');
    }
  });


  //check if room name is available
  socket.on('check roomName', function(data) {
    if (socket.userRooms && socket.userRooms[data.roomName]) {
      socket.emit('roomName failed');
    } else {
      socket.emit('roomName passed');
    }
  });

  //create room from name and randomly generated id, join
  socket.on('create room', function(data){
    var room = new Room(data.roomName, data.roomId);
    rooms[data.roomId] = room;
    socket.emit('redirect to room', {id: data.roomId});
  });

  //
  socket.on('check username', function(data){
    if (rooms[data.roomId] && !rooms[data.roomId].contains(data.username)) {
      socket.emit('username passed', {
        username: data.username
      });
    } else {
      socket.emit('username failed');
    }
  });

  socket.on('remove room', function(data){
    var roomId = socket.userRooms[data.roomName];
    if (data.roomName === rooms[socket.room].name) {
      socket.emit('cannot remove room');
    } else {
      socket.emit('remove room', {
        roomName: data.roomName
      });
    }
  });

  //called on valid submission of username
  socket.on('add user', function(username){
    addUser(socket, username);
  });

  socket.on('new message', function(msg){
    socket.broadcast.to(socket.room).emit('new message', {
      username: socket.username,
      message: msg
    });
  });

  socket.on('typing', function(){
    socket.broadcast.to(socket.room).emit('typing', {
      username: socket.username
    });
  });

  socket.on('stop typing', function(){
    socket.broadcast.to(socket.room).emit('stop typing', {
      username: socket.username
    });
  });

  socket.on('disconnect', function() {
    var room = socket.room;
    if (rooms[room] && userJoined && !socket.repeat) {
      --rooms[room].numUsers;
      rooms[room].removeMember(socket.username);

      //disconnect user socket from room
      socket.leave(room);

      socket.broadcast.to(room).emit('user left', {
        username: socket.username,
        numUsers: rooms[room].numUsers
      });
    }
  });
});


//if no username (i.e. new session), load login
//otherwise, join room and add user
function checkSession(socket, roomId, roomName) {
  var username = socket.request.session.username;
  if (!username) {
    socket.emit('load login');
    joinRoom(socket, roomId, roomName);
  } else {
    joinRoom(socket, roomId, roomName);
    addUser(socket, username);
    socket.emit('load chat page', {
      username: username
    });
  }
}


//create and add room to list, or simply join
function joinRoom(socket, roomId, roomName) {
  if (!rooms[roomId]) { //if room doesn't exist yet, add
    room = new Room(roomName, roomId);
    rooms[roomId] = room;
  }
  socket.join(roomId);

  //add user rooms based on session variables and newly submitted socket variables
  var sessRooms = socket.request.session.userRooms;
  if (sessRooms) {
    socket.userRooms = sessRooms;
  } else {
    var roomName = rooms[roomId].name;
    socket.userRooms = {roomName: roomId};
  }
}


function addUser(socket, name) {
  var room = socket.room;
  socket.username = name;

  if (!rooms[room].contains(name)) { //if user isn't already in the room
    userJoined = true;
    ++rooms[room].numUsers;
    rooms[room].addMember(name);

    //add a reference to the room if user has rooms and current room not on it
    console.log('Initial room references: ' + rooms[room].numReferences);

    var sessRooms = socket.request.session.userRooms;
    var prevRooms = socket.request.session.previousRooms;
    console.log('Initial session rooms: ' + JSON.stringify(sessRooms));
    console.log('Initial userRooms: ' + JSON.stringify(socket.userRooms));
    console.log('Initial previousRooms: ' + prevRooms);

    if (!prevRooms) {
      console.log('No previous visitations yet');
      ++rooms[room].numReferences;
    } else if (prevRooms.indexOf(rooms[room].name) === -1) {
      console.log('Room not on list yet');
      ++rooms[room].numReferences;
    } else {
      console.log('No references added');
    }

    //let everyone else know user has joined
    socket.broadcast.to(room).emit('user joined', {
      username: name,
      numUsers: rooms[room].numUsers
    });

    //for everyone else, only add new member
    socket.broadcast.to(room).emit('add user profile', {
        username: name
    });
  } else {
    socket.repeat = true;
  }

  updateSidebar(socket);
  console.log('New num references for ' + room + ': ' + rooms[room].numReferences);
  console.log('New socket userRooms: ' + JSON.stringify(socket.userRooms));
  console.log('');
}

function updateSidebar(socket) {
  var room = socket.room;

  //log user in with notification about number of participatns
  socket.emit('login', {
    numUsers: rooms[room].numUsers
  });

  //add all room members to list
  for (var i = 0; i < rooms[room].members.length; i++) {
    var user = rooms[room].members[i];
    socket.emit('add user profile', {
      username: user
    });
  }

  //add all user rooms to list
  for (var roomName in socket.userRooms) {
    if (roomName != 'Lobby') {
      var isCurrent = false;
      if (socket.userRooms[roomName] === socket.room) {
        isCurrent = true;
      }
      socket.emit('add room', {
        roomName: roomName,
        route: socket.userRooms[roomName],
        isCurrent: isCurrent
      });
    } else if (socket.room === 'lobby') {
      socket.emit('highlight lobby');
    }
  }
}

function contains(list, element) {
  return list.indexOf(element) != -1;
}
