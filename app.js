const express = require("express");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");

const app = express();
app.use(express.json());
const dbPath = path.join(__dirname, "twitterClone.db");
let db = null;

const initializeDbAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server running at http://localhost:3000/");
    });
  } catch (e) {
    console.log(`Error: ${e.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

// Register user API

app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(request.body.password, 10);
  let selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  let user = await db.get(selectUserQuery);
  if (user === undefined) {
    if (password.length >= 6) {
      const insertUserQuery = `INSERT INTO user (username, password, name, gender)
                VALUES ('${username}', '${hashedPassword}', 
                '${name}', '${gender}');`;
      await db.run(insertUserQuery);
      response.status(200);
      response.send("User created successfully");
    } else {
      response.status(400);
      response.send("Password is too short");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

// Login user API

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  user = await db.get(selectUserQuery);
  if (user === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, user.password);
    if (isPasswordMatched === true) {
      const payload = {
        username: username,
      };
      const jwToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      response.send({ jwToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

// Authenticate Token

const authenticateToken = (request, response, next) => {
  let jwToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwToken = authHeader.split(" ")[1];
  }
  if (jwToken === undefined) {
    response.status(401);
    response.send("Invalid JWT token");
  } else {
    jwt.verify(jwToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

// User Feed API

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { username } = request;
  const selectUserQuery = `SELECT user_id FROM user WHERE username = '${username}';`;
  const userId = await db.get(selectUserQuery);
  console.log(userId);
  const getFeedQuery = `SELECT user.username, tweet.tweet, tweet.date_time
        FROM (user JOIN follower ON user.user_id = follower.following_user_id) AS T
        JOIN tweet ON T.user_id = tweet.user_id
        WHERE follower.follower_user_id = ${userId}
        ORDER BY tweet.date_time DESC
        LIMIT 4;`;
  const feed = await db.all(getFeedQuery);
  response.send(feed);
});
