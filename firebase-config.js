// Shared Firebase setup for the ReWear browser app.
import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyD_qvPhXKlG71w362_-7iJ5fGo_y2LgrbU",
    authDomain: "rewear-webapp.firebaseapp.com",
    projectId: "rewear-webapp",
    messagingSenderId: "70356369670",
    appId: "1:70356369670:web:fbfb796cb3d2d38b415e87",
    measurementId: "G-WQT98GBSDF"
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
