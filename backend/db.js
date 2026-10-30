const mongoose = require('mongoose');

const connectDB = async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('====================================================================');
    console.error('[MongoDB Error] FATAL: MONGO_URI environment variable is missing.');
    console.error('Silent fallback to local MongoDB is disabled for security and data integrity.');
    console.error('Please configure your MongoDB Atlas connection string in your .env or Render dashboard:');
    console.error('  MONGO_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/quizbuilder?retryWrites=true&w=majority');
    console.error('====================================================================');
    return null;
  }

  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 8000
    });
    console.log(`[MongoDB] Connected successfully to host: ${conn.connection.host}`);
    console.log(`[MongoDB] Database name: ${conn.connection.name}`);
    return conn;
  } catch (error) {
    console.error(`[MongoDB Error] Connection failed: ${error.message}`);
    return null;
  }
};

module.exports = connectDB;

