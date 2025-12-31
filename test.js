import express from "express";

const app = express();

app.get("/", (req, res) => res.send("OK"));

const server = app.listen(4000, () => {
  console.log("Listening on 4000");
});

// OPTIONAL — make absolutely sure it stays “ref’d”
server.ref();
