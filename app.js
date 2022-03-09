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

// Checking that user request a tweet of the user he is following or not

const checkFollowingOrNot = async (request, response, next) => {
  const { tweetId } = request.params;
  const { username } = request;
  const selectUserQuery = `SELECT user_id FROM user WHERE username = '${username}';`;
  const userId = await db.get(selectUserQuery);
  const getFollowingQuery = `SELECT *
    FROM tweet JOIN follower ON tweet.user_id = follower.following_user_id
    WHERE follower.follower_user_id = ${userId.user_id};`;
  const following = await db.all(getFollowingQuery);
  if (following === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

// User Feed API

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { username } = request;
  const selectUserQuery = `SELECT user_id FROM user WHERE username = '${username}';`;
  const userId = await db.get(selectUserQuery);
  const getFeedQuery = `SELECT user.username, tweet.tweet, tweet.date_time 
        FROM (user JOIN follower ON user.user_id = follower.following_user_id) AS T
        JOIN tweet ON T.user_id = tweet.user_id
        WHERE T.follower_user_id = ${userId.user_id}
        ORDER BY tweet.date_time DESC
        LIMIT 4;`;
  const feed = await db.all(getFeedQuery);
  response.send(feed);
});

// User following names API

app.get("/user/following/", authenticateToken, async (request, response) => {
  const { username } = request;
  const selectUserQuery = `SELECT user_id FROM user WHERE username = '${username}';`;
  const userId = await db.get(selectUserQuery);
  const getFollowingQuery = `SELECT user.name 
    FROM user JOIN follower ON user.user_id = follower.following_user_id
    WHERE follower.follower_user_id = ${userId.user_id};`;
  const following = await db.all(getFollowingQuery);
  response.send(following);
});

// User followers names API

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { username } = request;
  const selectUserQuery = `SELECT user_id FROM user WHERE username = '${username}';`;
  const userId = await db.get(selectUserQuery);
  const getFollowersQuery = `SELECT user.name 
    FROM user JOIN follower ON user.user_id = follower.follower_user_id
    WHERE follower.following_user_id = ${userId.user_id};`;
  const followers = await db.all(getFollowersQuery);
  response.send(followers);
});

// Tweet details API

app.get(
  "/tweet/:tweetId/",
  authenticateToken,
  checkFollowingOrNot,
  async (request, response) => {
    const { tweetId } = request.params;
    const tweetDetailsQuery = `SELECT DISTINCT tweet.tweet, COUNT(like.like_id),
        COUNT(reply.reply_id), tweet.date_time
        FROM (tweet LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id) AS T
        RIGHT JOIN like ON tweet.tweet_id = like.tweet_id
        WHERE tweet.tweet_id = ${tweetId};`;
    const tweetDetails = await db.get(tweetDetailsQuery);
    response.send({
      tweet: tweetDetails.tweet,
      likes: tweetDetails["COUNT(like.like_id)"],
      replies: tweetDetails["COUNT(reply.reply_id)"],
      dateTime: tweetDetails["date_time"],
    });
  }
);

module.exports = app;
