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
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

// Authenticate Token

const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
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
    WHERE follower.follower_user_id = ${userId.user_id} 
    AND tweet.tweet_id = ${tweetId};`;
  const following = await db.get(getFollowingQuery);
  if (following === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

// User Feed API

const responsiveFeedObj = (eachObject) => {
  return {
    username: eachObject.username,
    tweet: eachObject.tweet,
    dateTime: eachObject.date_time,
  };
};

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
  response.send(feed.map(responsiveFeedObj));
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

const responsiveTweetObject = (tweetReplyDetails, tweetLikeDetails) => {
  return {
    tweet: tweetReplyDetails["tweet"],
    likes: tweetLikeDetails["COUNT(like_id)"],
    replies: tweetReplyDetails["COUNT(reply.reply_id)"],
    dateTime: tweetReplyDetails["date_time"],
  };
};

// Tweet details API

app.get(
  "/tweets/:tweetId/",
  authenticateToken,
  checkFollowingOrNot,
  async (request, response) => {
    const { tweetId } = request.params;
    let tweetReplyDetailsQuery = `SELECT DISTINCT tweet.tweet, COUNT(reply.reply_id), tweet.date_time
        FROM tweet JOIN reply ON tweet.tweet_id = reply.tweet_id
        WHERE tweet.tweet_id = ${tweetId};`;
    let tweetReplyDetails = await db.get(tweetReplyDetailsQuery);
    let tweetLikesDetailsQuery = `SELECT COUNT(like_id)
        FROM like
        WHERE tweet_id = ${tweetId};`;
    let tweetLikeDetails = await db.get(tweetLikesDetailsQuery);
    response.send(responsiveTweetObject(tweetReplyDetails, tweetLikeDetails));
  }
);

// Usernames who liked a tweet API

const getUsers = (users) => {
  let usernameArr = [];
  for (let eachObject of users) {
    usernameArr.push(eachObject.username);
  }
  return usernameArr;
};

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  checkFollowingOrNot,
  async (request, response) => {
    const { tweetId } = request.params;
    const getUsersQuery = `SELECT user.username
        FROM like JOIN user ON like.user_id = user.user_id
        WHERE like.tweet_id = ${tweetId};`;
    let likes = await db.all(getUsersQuery);
    response.send({
      likes: getUsers(likes),
    });
  }
);

// Replies of a tweet API

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  checkFollowingOrNot,
  async (request, response) => {
    const { tweetId } = request.params;
    const getRepliesQuery = `SELECT user.name, reply.reply
        FROM reply JOIN user ON reply.user_id = user.user_id
        WHERE reply.tweet_id = ${tweetId};`;
    const replies = await db.all(getRepliesQuery);
    response.send({
      replies,
    });
  }
);

// GET all tweets of the user API

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const selectUserQuery = `SELECT user_id FROM user WHERE username = '${username}';`;
  const userId = await db.get(selectUserQuery);
  let tweetsQuery = `SELECT tweet_id FROM tweet WHERE user_id = ${userId.user_id};`;
  let tweetIds = await db.all(tweetsQuery);
  let userTweets = [];
  for (let eachTweet of tweetIds) {
    let tweetReplyDetailsQuery = `SELECT DISTINCT tweet.tweet, COUNT(reply.reply_id), tweet.date_time
        FROM tweet JOIN reply ON tweet.tweet_id = reply.tweet_id
        WHERE tweet.tweet_id = ${eachTweet.tweet_id};`;
    let tweetReplyDetails = await db.get(tweetReplyDetailsQuery);
    let tweetLikesDetailsQuery = `SELECT COUNT(like_id)
        FROM like
        WHERE tweet_id = ${eachTweet.tweet_id};`;
    let tweetLikeDetails = await db.get(tweetLikesDetailsQuery);
    userTweets.push(responsiveTweetObject(tweetReplyDetails, tweetLikeDetails));
  }
  response.send(userTweets);
});

// Create new tweet API

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request.body;
  const { username } = request;
  const selectUserQuery = `SELECT user_id FROM user WHERE username = '${username}';`;
  const userId = await db.get(selectUserQuery);
  const date = new Date();
  const createTweetQuery = `INSERT INTO tweet (tweet, user_id, date_time)
        VALUES (
            '${tweet}',
            '${userId.user_id}',
            '${date}'
        );`;
  await db.run(createTweetQuery);
  response.send("Created a Tweet");
});

//Delete users tweet API

app.delete("/tweets/:tweetId", authenticateToken, async (request, response) => {
  const { tweetId } = request.params;
  const { username } = request;
  const checkTweetQuery = `SELECT * 
        FROM user JOIN tweet ON user.user_id = tweet.user_id
        WHERE user.username = '${username}'
        AND tweet.tweet_id = ${tweetId};`;
  const tweet = await db.get(checkTweetQuery);
  if (tweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    const deleteTweetQuery = `DELETE FROM tweet
        WHERE tweet_id = ${tweetId};`;
    await db.run(deleteTweetQuery);
    response.send("Tweet Removed");
  }
});

module.exports = app;
