// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCU8-qqFwQgYLKLAestHI6FAVU_olz2nYg",
  authDomain: "nochuti.firebaseapp.com",
  databaseURL: "https://nochuti-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "nochuti",
  storageBucket: "nochuti.firebasestorage.app",
  messagingSenderId: "725513929433",
  appId: "1:725513929433:web:eb3dae69827740337b34c8",
  measurementId: "G-BL1QGBE5D3"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
