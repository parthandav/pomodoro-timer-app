// Firebase Project Configuration
// -------------------------------------------------------
// SETUP INSTRUCTIONS:
// 1. Go to https://console.firebase.google.com/
// 2. Create a new project (or select an existing one)
// 3. In Project Settings > General, scroll to "Your apps"
// 4. Click "Add app" → Web (</>), register the app
// 5. Copy the firebaseConfig object values below
// 6. In Authentication > Sign-in method, enable "Google"
// 7. In Firestore Database, click "Create database"
//    (start in production mode, choose a region)
// 8. In Firestore > Rules, paste:
//      rules_version = '2';
//      service cloud.firestore {
//        match /databases/{database}/documents {
//          match /users/{userId}/{document=**} {
//            allow read, write: if request.auth != null && request.auth.uid == userId;
//          }
//        }
//      }
// -------------------------------------------------------

const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};
