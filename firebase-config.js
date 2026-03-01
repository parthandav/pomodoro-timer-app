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
  apiKey: "AIzaSyB8kBconwOkoBXwG5C7j-hoKw_V0Vdn3a8",
  authDomain: "pomodorowa-c899d.firebaseapp.com",
  projectId: "pomodorowa-c899d",
  storageBucket: "pomodorowa-c899d.firebasestorage.app",
  messagingSenderId: "887941166616",
  appId: "1:887941166616:web:48502df466048d4f14f56d",
  measurementId: "G-7PJEDF8FQG"
};
