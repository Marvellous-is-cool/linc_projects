const express = require("express");
const bodyParser = require("body-parser");
const mysql = require("mysql");
const favicon = require("serve-favicon");
const path = require("path");
const app = express();

app.set("view engine", "ejs");
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

// Use serve-favicon middleware
app.use(favicon(path.join(__dirname, "public/images/", "favicon.ico")));

// Database connection
const db = mysql.createConnection({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASS || "",
  port: process.env.DB_PORT || "",
  database: "linc_project_topics",
});

db.connect((err) => {
  if (err) throw err;
  console.log("Connected to database");
});

app.get("/", (req, res) => {
  res.render("index");
});

app.post("/name", (req, res) => {
  const name = req.body.name;

  // Check if the name already exists in the users table
  db.query(
    "SELECT COUNT(*) as count FROM users WHERE name = ?",
    [name],
    (err, userResults) => {
      if (err) throw err;

      if (userResults[0].count > 0) {
        // Name exists in the users table, check topic tables
        db.query(
          `SELECT COUNT(*) as count FROM linguistics_topics WHERE assigned_to = ?
           UNION
           SELECT COUNT(*) as count FROM communication_topics WHERE assigned_to = ?
           UNION
           SELECT COUNT(*) as count FROM integrated_topics WHERE assigned_to = ?`,
          [name, name, name],
          (err, topicResults) => {
            if (err) throw err;

            // Sum up the counts from the three queries
            const totalAssigned = topicResults.reduce(
              (total, row) => total + row.count,
              0
            );

            if (totalAssigned > 0) {
              // Name is assigned to at least one topic
              res.render("index", {
                error: "The user already exists and has selected a topic.",
              });
            } else {
              // Name exists in users table but not in any topic tables
              res.render("selection", { name });
            }
          }
        );
      } else {
        // Name does not exist in the users table, check topic tables
        db.query(
          `SELECT COUNT(*) as count FROM linguistics_topics WHERE assigned_to = ?
           UNION
           SELECT COUNT(*) as count FROM communication_topics WHERE assigned_to = ?
           UNION
           SELECT COUNT(*) as count FROM integrated_topics WHERE assigned_to = ?`,
          [name, name, name],
          (err, topicResults) => {
            if (err) throw err;

            // Sum up the counts from the three queries
            const totalAssigned = topicResults.reduce(
              (total, row) => total + row.count,
              0
            );

            if (totalAssigned > 0) {
              // Name is in topic tables
              res.render("index", {
                error: "The user already exists and has selected a topic.",
              });
            } else {
              // Name does not exist in either users or topic tables, insert it
              db.query("INSERT INTO users (name) VALUES (?)", [name], (err) => {
                if (err) throw err;
                res.render("selection", { name });
              });
            }
          }
        );
      }
    }
  );
});

app.post("/branches", (req, res) => {
  const { name, interest } = req.body;
  let query;

  if (interest === "linguistics") {
    query = "SELECT branch_name FROM branches WHERE type = 'linguistics'";
  } else if (interest === "communication") {
    query = "SELECT branch_name FROM branches WHERE type = 'communication'";
  } else if (interest === "both") {
    query = "SELECT branch_name FROM branches WHERE type = 'both'";
  }

  db.query(query, (err, results) => {
    if (err) throw err;
    const branches = results.map((result) => result.branch_name);
    res.render("branches", { name, interest, branches });
  });
});

app.post("/generate", (req, res) => {
  const { name, interest, branches, action } = req.body;
  let table;

  if (interest === "linguistics") {
    table = "linguistics_topics";
  } else if (interest === "communication") {
    table = "communication_topics";
  } else if (interest === "both") {
    table = "integrated_topics";
  }

  const branchesArray = Array.isArray(branches) ? branches : [branches];

  const sql = `SELECT * FROM ${table} WHERE branch IN (?) AND assigned_to IS NULL`;
  db.query(sql, [branchesArray], (err, topics) => {
    if (err) throw err;
    res.render("topics", { name, topics });
  });
});

app.post("/generate-random", (req, res) => {
  const { name, interest } = req.body;
  let branchQuery;
  let table;

  if (interest === "linguistics") {
    branchQuery = "SELECT branch_name FROM branches WHERE type = 'linguistics'";
    table = "linguistics_topics";
  } else if (interest === "communication") {
    branchQuery =
      "SELECT branch_name FROM branches WHERE type = 'communication'";
    table = "communication_topics";
  } else if (interest === "both") {
    branchQuery = "SELECT branch_name FROM branches WHERE type = 'both'";
    table = "integrated_topics";
  }

  db.query(branchQuery, (err, branchResults) => {
    if (err) throw err;
    const branchesArray = branchResults.map((result) => result.branch_name);

    // Randomly select between 2 to 6 branches
    const minBranches = 2;
    const maxBranches = Math.min(6, branchesArray.length); // Limit to available branches count
    const numBranches =
      Math.floor(Math.random() * (maxBranches - minBranches + 1)) + minBranches;

    // Shuffle branches and select the required number
    const shuffledBranches = branchesArray.sort(() => 0.5 - Math.random());
    const selectedBranches = shuffledBranches.slice(0, numBranches);

    const sql = `SELECT * FROM ${table} WHERE branch IN (?) AND assigned_to IS NULL`;
    db.query(sql, [selectedBranches], (err, topics) => {
      if (err) throw err;
      res.render("topics", { name, topics });
    });
  });
});

app.get("/claim", (req, res) => {
  const { name, topics } = req.query;

  const topicsArray = topics ? topics.split(",") : [];
  if (topicsArray.length > 0) {
    let queries = [];
    let table;

    db.query(
      `SELECT branch FROM integrated_topics WHERE id = ? UNION
               SELECT branch FROM linguistics_topics WHERE id = ? UNION
               SELECT branch FROM communication_topics WHERE id = ?`,
      [topicsArray[0], topicsArray[0], topicsArray[0]],
      (err, results) => {
        if (err) throw err;
        const branch = results[0].branch;

        if (branch === "linguistics") {
          table = "linguistics_topics";
        } else if (branch === "communication") {
          table = "communication_topics";
        } else {
          table = "integrated_topics";
        }

        db.query(
          `SELECT COUNT(*) as count FROM ${table} WHERE assigned_to = ?`,
          [name],
          (err, result) => {
            if (err) throw err;

            if (result[0].count + topicsArray.length <= 2) {
              topicsArray.forEach((topicId) => {
                queries.push(
                  new Promise((resolve, reject) => {
                    db.query(
                      `UPDATE ${table} SET assigned_to = ? WHERE id = ? AND assigned_to IS NULL`,
                      [name, topicId],
                      (err) => {
                        if (err) return reject(err);
                        resolve();
                      }
                    );
                  })
                );
              });

              Promise.all(queries)
                .then(() => {
                  db.query(
                    `SELECT topic FROM ${table} WHERE id IN (?)`,
                    [topicsArray],
                    (err, claimedTopics) => {
                      if (err) throw err;

                      res.render("claim", {
                        message: "Topics claimed successfully!",
                        claimedTopics,
                      });
                    }
                  );
                })
                .catch((err) => {
                  console.error(err);
                  res.render("claim", {
                    message: "An error occurred while claiming topics.",
                    claimedTopics: [],
                  });
                });
            } else {
              res.render("claim", {
                message:
                  "You have already claimed the maximum number of topics.",
                claimedTopics: [],
              });
            }
          }
        );
      }
    );
  } else {
    res.render("claim", {
      message: "No topics selected for claiming.",
      claimedTopics: [],
    });
  }
});

// Error handling for unknown routes
app.use((req, res) => {
  res.status(404).send("Page not found");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
