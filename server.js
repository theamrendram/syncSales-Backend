const app = require("./src/app");


const port = process.env.PORT || 8000;
app.listen(port, () => {
    console.log(`server is running on port ${port}`);
})