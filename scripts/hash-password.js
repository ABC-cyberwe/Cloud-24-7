const bcrypt = require("bcryptjs");

const password = process.argv.slice(2).join(" ");

if (!password) {
  console.error('Usage: npm.cmd run hash-password -- "YourStrongAdminPassword"');
  process.exit(1);
}

bcrypt.hash(password, 12)
  .then((hash) => {
    console.log(hash);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
