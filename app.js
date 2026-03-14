// Firebase setup (compat SDK loaded via index.html)
// firebase.initializeApp is called here after firebase-config.js is loaded
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Current signed-in user (null when not authenticated)
let currentUser = null;

// Timer State
let workDuration = 25 * 60; // Default 25 minutes in seconds

let currentTime = workDuration;
let isRunning = false;
let currentMode = 'work'; // 'work' or 'break'
let endTime = null; // Timestamp when timer should reach 0
let breakStartTime = null; // Timestamp when break started (for open-ended breaks)
let isBreakActive = false; // Whether a break is currently in progress
// Single dedicated Worker for timer ticks.
let timerWorker = new Worker('timer-worker.js');
let swRegistration = null; // Service Worker registration for OS-level timer notifications

// ─── Background-throttle prevention ─────────────────────────────────────────
// Chrome 88+ suspends AudioContexts of background tabs and then applies
// intensive timer throttling (1-min minimum) to all JS including Workers.
// Fix requires TWO things:
//   1. A non-zero audio signal — Chrome can silently optimize away gain=0,
//      so we use a 1 Hz sine oscillator (below hearing range, 0.001 gain).
//      Chrome sees actual non-zero audio being rendered → no optimization.
//   2. onstatechange auto-resume — Chrome will still try to suspend the context;
//      we immediately call resume() so the state never stays "suspended".
let _keepAliveCtx = null;
let _keepAliveOsc = null;

function startKeepAlive() {
    stopKeepAlive();
    try {
        _keepAliveCtx = new (window.AudioContext || window.webkitAudioContext)();

        // 1 Hz oscillator — completely inaudible (human hearing starts at ~20 Hz)
        // but produces genuinely non-zero audio data Chrome cannot optimize away.
        _keepAliveOsc = _keepAliveCtx.createOscillator();
        const gain = _keepAliveCtx.createGain();
        _keepAliveOsc.frequency.value = 1;   // 1 Hz
        gain.gain.value = 0.001;             // 0.1% volume — inaudible
        _keepAliveOsc.connect(gain);
        gain.connect(_keepAliveCtx.destination);
        _keepAliveOsc.start(0);

        // Chrome suspends AudioContexts of background tabs; resume immediately
        // whenever that happens so the context never stays in "suspended" state.
        _keepAliveCtx.onstatechange = () => {
            if (_keepAliveCtx && _keepAliveCtx.state === 'suspended') {
                _keepAliveCtx.resume().catch(() => {});
            }
        };
    } catch (e) {
        // AudioContext unavailable
    }
}

function stopKeepAlive() {
    try {
        if (_keepAliveOsc) { _keepAliveOsc.stop(); _keepAliveOsc.disconnect(); }
        if (_keepAliveCtx) { _keepAliveCtx.close(); }
    } catch (e) {}
    _keepAliveCtx = null;
    _keepAliveOsc = null;
}
let tasks = [];

// Categories State
let categories = [];
let currentView = 'timer'; // 'timer', 'categories', 'projects', or 'history'
let selectedCategoryColor = '#0891b2'; // Default blue color

// Projects State
let projects = [];
let selectedProjectId = null;

// Predefined category colors
const CATEGORY_COLORS = ['#0891b2', '#8b5cf6', '#f59e0b', '#10b981', '#ec4899', '#ef4444'];

// DOM Elements
const timerDisplay = document.getElementById('timerDisplay');
const startPauseBtn = document.getElementById('startPauseBtn');
const resetBtn = document.getElementById('resetBtn');
const switchModeBtn = document.getElementById('switchModeBtn');
const modeIndicator = document.getElementById('modeIndicator');
const taskInput = document.getElementById('taskInput');
const taskList = document.getElementById('taskList');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const completionMessage = document.getElementById('completionMessage');
const durationSelector = document.getElementById('durationSelector');

// Navigation Elements
const timerNavBtn = document.getElementById('timerNavBtn');
const categoriesNavBtn = document.getElementById('categoriesNavBtn');
const projectsNavBtn = document.getElementById('projectsNavBtn');
const historyNavBtn = document.getElementById('historyNavBtn');
const timerView = document.getElementById('timerView');
const categoriesView = document.getElementById('categoriesView');
const projectsView = document.getElementById('projectsView');
const historyView = document.getElementById('historyView');

// History Elements
const dateSelectorBar = document.getElementById('dateSelectorBar');
const historyTaskList = document.getElementById('historyTaskList');
const clearAllHistoryBtn = document.getElementById('clearAllHistoryBtn');

// Category Elements
const categorySelect = document.getElementById('categorySelect');
const categoriesList = document.getElementById('categoriesList');
const newCategoryName = document.getElementById('newCategoryName');
const newCategoryColor = document.getElementById('newCategoryColor');
const addCategoryBtn = document.getElementById('addCategoryBtn');
const colorPicker = document.getElementById('colorPicker');

// Project Elements
const projectsList = document.getElementById('projectsList');
const newProjectName = document.getElementById('newProjectName');
const newProjectCategory = document.getElementById('newProjectCategory');
const addProjectBtn = document.getElementById('addProjectBtn');
const projectSelector = document.getElementById('projectSelector');
const projectFavourites = document.getElementById('projectFavourites');
const projectSelect = document.getElementById('projectSelect');

// Initialize app — sets up event listeners and Firebase auth.
// Data loading happens inside loadUserData() after sign-in.
function init() {
    registerServiceWorker();
    setupEventListeners();
    setupNavigation();
    setupColorPicker();
    setupDurationSelector();
    requestNotificationPermission();
    setupVisibilityHandler();
    setupProjectListeners();
    initFirebaseAuth();
}

// Register Service Worker and listen for timer-complete messages from it
function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw.js')
        .then((registration) => {
            swRegistration = registration;
        })
        .catch((err) => {
            console.log('Service Worker registration failed:', err);
        });

    // When SW fires timer-complete (e.g. notification arrived while tab was hidden),
    // ensure the timer state is updated in the main thread too.
    navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'timer-complete') {
            if (isRunning && currentMode === 'work') {
                timerComplete();
            }
        }
    });
}

// Post a message to the active Service Worker (if available)
function postToSW(message) {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then((registration) => {
        if (registration.active) {
            registration.active.postMessage(message);
        }
    }).catch(() => {});
}

// ─── Firebase Auth ────────────────────────────────────────────────────────────

function initFirebaseAuth() {
    document.getElementById('googleSignInBtn').addEventListener('click', handleSignIn);
    document.getElementById('signOutBtn').addEventListener('click', handleSignOut);

    auth.onAuthStateChanged(async (user) => {
        if (user) {
            await loadUserData(user);
            document.getElementById('signinOverlay').style.display = 'none';
        } else {
            showSignIn();
        }
    });
}

async function handleSignIn() {
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
        await auth.signInWithPopup(provider);
    } catch (err) {
        alert('Sign-in failed: ' + err.message);
    }
}

async function handleSignOut() {
    if (isRunning) {
        if (!confirm('A timer is running. Sign out anyway?')) return;
        pauseTimer();
    }
    await auth.signOut();
    currentUser = null;
    tasks = [];
    categories = [];
    projects = [];
    selectedProjectId = null;
}

function showSignIn() {
    document.getElementById('signinOverlay').style.display = 'flex';
    document.getElementById('userProfile').style.display = 'none';
}

async function loadUserData(user) {
    currentUser = user;

    // Update user profile chip in header
    const userProfile = document.getElementById('userProfile');
    const userAvatar = document.getElementById('userAvatar');
    const userName = document.getElementById('userName');
    userProfile.style.display = 'flex';
    userAvatar.src = user.photoURL || '';
    userAvatar.alt = user.displayName || 'User';
    userName.textContent = user.displayName || user.email;

    // Load all user data from Firestore
    await loadCategories();
    await loadProjects();
    await loadTaskHistory();

    // Render UI with loaded data
    updateDisplay();
    renderCategorySelector();
    renderProjectSelector();

    // Offer one-time migration from localStorage (for existing users)
    await offerLocalStorageMigration();
}

// Migrate localStorage data into Firestore the first time a user signs in
async function offerLocalStorageMigration() {
    const localTasks = localStorage.getItem('pomodoroTasks');
    const localCategories = localStorage.getItem('pomodoroCategories');

    if (!localTasks && !localCategories) return; // Nothing to migrate
    if (tasks.length > 0 || categories.length > 2) return; // Firestore already has real data

    const doImport = confirm(
        'We found existing data on this device (tasks and categories from before sign-in). ' +
        'Import it into your account?'
    );
    if (!doImport) {
        localStorage.removeItem('pomodoroTasks');
        localStorage.removeItem('pomodoroCategories');
        localStorage.removeItem('pomodoroProjects');
        return;
    }

    // Import categories
    if (localCategories) {
        try {
            const localCats = JSON.parse(localCategories);
            if (localCats.length > 0) {
                // Merge: add any local categories not already in Firestore
                const firestoreNames = new Set(categories.map(c => c.name.toLowerCase()));
                localCats.forEach(cat => {
                    if (!firestoreNames.has(cat.name.toLowerCase())) {
                        categories.push(cat);
                    }
                });
                await saveCategories();
                renderCategorySelector();
            }
        } catch (e) { /* ignore parse errors */ }
    }

    // Import tasks
    if (localTasks) {
        try {
            const localTaskArray = JSON.parse(localTasks);
            const batch = db.batch();
            localTaskArray.forEach(task => {
                if (!task.id) task.id = generateId();
                const ref = db.collection(`users/${currentUser.uid}/tasks`).doc(task.id);
                batch.set(ref, task);
            });
            await batch.commit();
            tasks = [...localTaskArray, ...tasks].sort(
                (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
            );
            displayTaskHistory();
        } catch (e) { /* ignore */ }
    }

    // Clear localStorage after successful migration
    localStorage.removeItem('pomodoroTasks');
    localStorage.removeItem('pomodoroCategories');
    localStorage.removeItem('pomodoroProjects');
}

// ─── End Firebase Auth ────────────────────────────────────────────────────────

// Request notification permission on page load
function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

// Wire up the single persistent Worker's message handler.
// The Worker sends 'tick' every ~500ms and 'complete' when focus time runs out.
timerWorker.onmessage = function (e) {
    if (e.data.type === 'complete') {
        timerComplete();
    } else if (e.data.type === 'tick') {
        if (e.data.remaining !== undefined) {
            currentTime = e.data.remaining;
        } else if (e.data.elapsed !== undefined) {
            currentTime = e.data.elapsed;
        }
        updateDisplay();
        updateTabTitle();
    }
};

function stopTimerWorker() {
    timerWorker.postMessage({ type: 'stop' });
}

// Visibility change handler — tab became visible again.
// Immediately corrects the display from Date.now() (no waiting for next Worker tick)
// and catches any completion that happened while the tab was hidden.
function setupVisibilityHandler() {
    document.addEventListener('visibilitychange', () => {
        // When tab hides, Chrome will try to suspend our AudioContext.
        // Pre-emptively call resume() so it stays in "running" state.
        if (document.hidden && isRunning && _keepAliveCtx) {
            _keepAliveCtx.resume().catch(() => {});
        }

        if (document.hidden || !isRunning) return;

        if (currentMode === 'work' && endTime) {
            const remainingMs = endTime - Date.now();
            if (remainingMs <= 0) {
                timerComplete();
                return;
            }
            // Snap display to accurate time immediately; Worker will continue ticking
            currentTime = Math.max(0, Math.ceil(remainingMs / 1000));
            updateDisplay();
            updateTabTitle();
        } else if (currentMode === 'break' && breakStartTime) {
            currentTime = Math.floor((Date.now() - breakStartTime) / 1000);
            updateDisplay();
            updateTabTitle();
        }
    });
}

// Event Listeners
function setupEventListeners() {
    startPauseBtn.addEventListener('click', toggleTimer);
    resetBtn.addEventListener('click', resetTimer);
    switchModeBtn.addEventListener('click', switchMode);
    clearHistoryBtn.addEventListener('click', clearTaskHistory);
    addCategoryBtn.addEventListener('click', handleAddCategory);
}

// Timer Functions
function toggleTimer() {
    if (isRunning) {
        pauseTimer();
    } else {
        startTimer();
    }
}

function startTimer() {
    // Hide any completion message from previous session
    completionMessage.classList.add('hidden');

    // Validation: Check if task is entered for work mode
    if (currentMode === 'work' && !taskInput.value.trim()) {
        alert('Please enter what you\'re working on before starting the timer!');
        taskInput.focus();
        return;
    }

    isRunning = true;
    startKeepAlive(); // prevent Chrome's 5-min background throttling

    if (currentMode === 'break') {
        // Break mode: count UP (elapsed time)
        if (!isBreakActive) {
            isBreakActive = true;
            breakStartTime = Date.now();
        }

        // Hide start/pause button during break (breaks don't pause)
        startPauseBtn.style.display = 'none';

        timerWorker.postMessage({ type: 'start-break', startTime: breakStartTime });

    } else {
        // Focus mode: count DOWN (remaining time)
        startPauseBtn.textContent = 'Pause';
        startPauseBtn.classList.add('active');

        endTime = Date.now() + (currentTime * 1000);

        timerWorker.postMessage({ type: 'start-focus', endTime: endTime });

        // Schedule OS-level notification via Service Worker (fires even when tab is throttled)
        postToSW({
            type: 'schedule-completion',
            endTime: endTime,
            taskName: taskInput.value.trim()
        });
    }
}

function pauseTimer() {
    isRunning = false;
    stopTimerWorker();
    stopKeepAlive(); // allow Chrome to throttle again once timer is not running
    postToSW({ type: 'cancel-completion' });

    if (currentMode === 'work') {
        startPauseBtn.textContent = 'Start';
        startPauseBtn.classList.remove('active');

        // Calculate and save the actual remaining time when pausing
        if (endTime !== null) {
            const remainingMs = endTime - Date.now();
            currentTime = Math.max(0, Math.ceil(remainingMs / 1000));
            endTime = null;
        }
    }
    // For breaks, we don't update currentTime here - it keeps showing elapsed time

    updateDisplay();
    document.title = 'Pomodoro Timer';
}

function resetTimer() {
    pauseTimer();
    endTime = null;

    if (currentMode === 'work') {
        currentTime = workDuration;
    } else {
        // Reset break elapsed time to 0 and restart tracking
        currentTime = 0;
        breakStartTime = Date.now();
    }

    updateDisplay();
    document.title = 'Pomodoro Timer';
}

function switchMode() {
    if (currentMode === 'work') {
        // Switching TO break mode
        pauseTimer();

        currentMode = 'break';
        currentTime = 0; // Break starts at 00:00 and counts up
        modeIndicator.textContent = 'Break Mode';
        modeIndicator.classList.add('break-mode');
        timerDisplay.classList.add('break-mode');
        startPauseBtn.classList.add('break-mode');
        switchModeBtn.textContent = 'Switch to Focus';
        durationSelector.classList.add('hidden');

        // Auto-start break timer immediately
        isBreakActive = true;
        breakStartTime = Date.now();
        startTimer(); // This will start the count-up interval

        updateDisplay();
    } else {
        // Switching FROM break TO focus mode
        // Calculate break duration before stopping
        let breakDuration = 0;
        if (isBreakActive && breakStartTime) {
            breakDuration = Math.floor((Date.now() - breakStartTime) / 1000);
        }

        pauseTimer();

        // Prompt for break activity
        const breakActivity = prompt('What did you do during your break?', 'Break');
        const description = (breakActivity && breakActivity.trim()) ? breakActivity.trim() : 'Break';

        // Save break to history with actual duration
        saveTaskToHistory(description, 'break', breakDuration);

        // Reset break state
        isBreakActive = false;
        breakStartTime = null;

        // Switch to focus mode
        currentMode = 'work';
        currentTime = workDuration;
        modeIndicator.textContent = 'Focus Mode';
        modeIndicator.classList.remove('break-mode');
        timerDisplay.classList.remove('break-mode');
        startPauseBtn.classList.remove('break-mode');
        startPauseBtn.style.display = ''; // Show start button again
        switchModeBtn.textContent = 'Switch to Break';
        durationSelector.classList.remove('hidden');

        updateDisplay();
        document.title = 'Pomodoro Timer';
    }
}

function timerComplete() {
    // Breaks never auto-complete - they run until user switches to focus
    if (currentMode === 'break') return;

    // Guard against double-firing (Worker message + visibilitychange can both trigger this)
    if (!isRunning && currentTime > 0) return;

    // Capture endTime before pauseTimer() clears it
    const completionTime = endTime;
    pauseTimer();

    // Play completion sound
    playCompletionSound();

    // Save focus session to history (use endTime as completion timestamp, not now)
    const completedTaskName = taskInput.value.trim() || 'Untitled Task';
    saveTaskToHistory(completedTaskName, currentMode, workDuration, completionTime);
    taskInput.value = ''; // Clear input after completion

    // Show inline completion message
    showCompletionMessage(completedTaskName);

    // Show browser notification
    showNotification(
        'Focus Complete!',
        `Great job! You completed: ${completedTaskName}`
    );

    // Flash the tab title to get attention
    flashTabTitle();

    // Reset timer
    resetTimer();
}

function updateDisplay() {
    timerDisplay.textContent = formatTime(currentTime);
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatDuration(seconds) {
    if (seconds < 60) {
        return `${seconds} sec`;
    }
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
        return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
    return `${mins} min`;
}

function updateTabTitle() {
    if (isRunning) {
        const modeText = currentMode === 'work' ? 'Focus' : 'Break';
        document.title = `${formatTime(currentTime)} - ${modeText}`;
    } else {
        document.title = 'Pomodoro Timer';
    }
}

function showCompletionMessage(taskName) {
    completionMessage.textContent = `Focus session complete! Great job on: ${taskName}`;
    completionMessage.classList.remove('hidden');

    // Auto-hide after 10 seconds
    setTimeout(() => {
        completionMessage.classList.add('hidden');
    }, 10000);
}

function flashTabTitle() {
    let flashCount = 0;
    const maxFlashes = 6;
    const flashInterval = setInterval(() => {
        document.title = flashCount % 2 === 0 ? '🎉 TIME\'S UP! 🎉' : 'Pomodoro Timer';
        flashCount++;
        if (flashCount >= maxFlashes) {
            clearInterval(flashInterval);
            document.title = 'Pomodoro Timer';
        }
    }, 500);
}

function showNotification(title, body) {
    // Check if browser supports notifications
    if (!('Notification' in window)) {
        console.log('Browser does not support notifications');
        return;
    }

    // Check permission and show notification
    if (Notification.permission === 'granted') {
        const notification = new Notification(title, {
            body: body,
            icon: '🍅', // You could replace this with an actual icon file path
            badge: '🍅',
            tag: 'pomodoro-timer',
            requireInteraction: true, // Keeps notification until user interacts
            silent: false
        });

        // Auto-close notification after 10 seconds if user doesn't interact
        setTimeout(() => notification.close(), 10000);

        // Focus window when notification is clicked
        notification.onclick = () => {
            window.focus();
            notification.close();
        };
    } else if (Notification.permission !== 'denied') {
        // Request permission if not already denied
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                showNotification(title, body);
            }
        });
    }
}

function playCompletionSound() {
    // Create a more noticeable completion sound with multiple beeps
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();

        // Play three beeps with increasing pitch
        const beeps = [
            { time: 0, frequency: 600, duration: 0.15 },
            { time: 0.2, frequency: 700, duration: 0.15 },
            { time: 0.4, frequency: 800, duration: 0.3 }
        ];

        beeps.forEach(beep => {
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.frequency.value = beep.frequency;
            oscillator.type = 'sine';

            const startTime = audioContext.currentTime + beep.time;
            const endTime = startTime + beep.duration;

            gainNode.gain.setValueAtTime(0.3, startTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, endTime);

            oscillator.start(startTime);
            oscillator.stop(endTime);
        });
    } catch (error) {
        console.log('Audio playback not supported');
    }
}

// View Switching Functions
function setupNavigation() {
    timerNavBtn.addEventListener('click', () => showView('timer'));
    categoriesNavBtn.addEventListener('click', () => showView('categories'));
    projectsNavBtn.addEventListener('click', () => showView('projects'));
    historyNavBtn.addEventListener('click', () => showView('history'));
    clearAllHistoryBtn.addEventListener('click', clearTaskHistory);
}

function showView(viewName) {
    currentView = viewName;

    // Hide all views
    timerView.classList.add('hidden');
    categoriesView.classList.add('hidden');
    projectsView.classList.add('hidden');
    historyView.classList.add('hidden');

    // Deactivate all nav buttons
    timerNavBtn.classList.remove('active');
    categoriesNavBtn.classList.remove('active');
    projectsNavBtn.classList.remove('active');
    historyNavBtn.classList.remove('active');

    // Show selected view
    if (viewName === 'timer') {
        timerView.classList.remove('hidden');
        timerNavBtn.classList.add('active');
    } else if (viewName === 'categories') {
        categoriesView.classList.remove('hidden');
        categoriesNavBtn.classList.add('active');
        renderCategories();
    } else if (viewName === 'projects') {
        projectsView.classList.remove('hidden');
        projectsNavBtn.classList.add('active');
        renderProjects();
        renderNewProjectCategoryDropdown();
    } else if (viewName === 'history') {
        historyView.classList.remove('hidden');
        historyNavBtn.classList.add('active');
        initHistoryView();
        initReportPanel();
    }
}

// Category Management Functions
async function loadCategories() {
    if (!currentUser) return;
    try {
        const snap = await db.doc(`users/${currentUser.uid}/data/categories`).get();
        if (snap.exists && snap.data().categories && snap.data().categories.length > 0) {
            categories = snap.data().categories;
        } else {
            await createDefaultCategories();
        }
    } catch (err) {
        console.error('Error loading categories:', err);
        if (categories.length === 0) await createDefaultCategories();
    }
}

async function createDefaultCategories() {
    categories = [
        { id: generateId(), name: 'Work', isDefault: true, color: '#0891b2' },
        { id: generateId(), name: 'Learn', isDefault: false, color: '#8b5cf6' }
    ];
    await saveCategories();
}

function saveCategories() {
    if (!currentUser) return Promise.resolve();
    return db.doc(`users/${currentUser.uid}/data/categories`)
        .set({ categories })
        .catch(err => console.error('Error saving categories:', err));
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function getDefaultCategory() {
    return categories.find(cat => cat.isDefault) || categories[0];
}

function getCategoryById(id) {
    return categories.find(cat => cat.id === id);
}

function addCategory(name, color) {
    if (!name || !name.trim()) {
        alert('Please enter a category name');
        return false;
    }

    // Check for duplicate names
    if (categories.some(cat => cat.name.toLowerCase() === name.trim().toLowerCase())) {
        alert('A category with this name already exists');
        return false;
    }

    const newCategory = {
        id: generateId(),
        name: name.trim(),
        isDefault: false,
        color: color || '#0891b2'
    };

    categories.push(newCategory);
    saveCategories();
    renderCategories();
    renderCategorySelector();

    return true;
}

function deleteCategory(id) {
    if (categories.length === 1) {
        alert('Cannot delete the last category. You must have at least one category.');
        return false;
    }

    const category = getCategoryById(id);
    if (!category) return false;

    // Count tasks with this category
    const affectedTasks = tasks.filter(task => task.category === id);
    const defaultCat = getDefaultCategory();

    let confirmMsg = `Are you sure you want to delete "${category.name}"?`;
    if (affectedTasks.length > 0) {
        confirmMsg += `\n\n${affectedTasks.length} task(s) will be reassigned to "${defaultCat.name}".`;
    }

    if (!confirm(confirmMsg)) {
        return false;
    }

    // Reassign tasks to default category
    if (affectedTasks.length > 0) {
        tasks.forEach(task => {
            if (task.category === id) {
                task.category = defaultCat.id;
                task.categoryName = defaultCat.name;
            }
        });
        saveAllTasksToFirestore();
        displayTaskHistory();
    }

    // If deleting the default category, set a new default
    if (category.isDefault && categories.length > 1) {
        const remainingCategories = categories.filter(cat => cat.id !== id);
        remainingCategories[0].isDefault = true;
    }

    categories = categories.filter(cat => cat.id !== id);
    saveCategories();

    // Reassign projects that referenced the deleted category to the new default
    const newDefault = getDefaultCategory();
    let projectsUpdated = false;
    projects.forEach(project => {
        if (project.categoryId === id) {
            project.categoryId = newDefault.id;
            projectsUpdated = true;
        }
    });
    if (projectsUpdated) {
        saveProjects();
        renderProjectSelector();
    }

    renderCategories();
    renderCategorySelector();

    return true;
}

function setDefaultCategory(id) {
    categories.forEach(cat => {
        cat.isDefault = (cat.id === id);
    });
    saveCategories();
    renderCategories();
    renderCategorySelector();
}

// Category UI Functions
function renderCategories() {
    if (categories.length === 0) {
        categoriesList.innerHTML = '<p class="empty-state">No categories yet. Add one below!</p>';
        return;
    }

    categoriesList.innerHTML = '';

    categories.forEach(category => {
        const categoryCard = document.createElement('div');
        categoryCard.className = 'category-card';
        categoryCard.style.borderLeftColor = category.color;

        const categoryInfo = document.createElement('div');
        categoryInfo.className = 'category-info';

        const colorIndicator = document.createElement('div');
        colorIndicator.className = 'category-color-indicator';
        colorIndicator.style.backgroundColor = category.color;

        const categoryName = document.createElement('div');
        categoryName.className = 'category-name';
        categoryName.textContent = category.name;

        categoryInfo.appendChild(colorIndicator);
        categoryInfo.appendChild(categoryName);

        const badges = document.createElement('div');
        badges.className = 'category-badges';

        if (category.isDefault) {
            const defaultBadge = document.createElement('span');
            defaultBadge.className = 'default-badge';
            defaultBadge.textContent = 'Default';
            badges.appendChild(defaultBadge);
        }

        const actions = document.createElement('div');
        actions.className = 'category-actions';

        if (!category.isDefault) {
            const setDefaultBtn = document.createElement('button');
            setDefaultBtn.className = 'btn btn-small btn-icon';
            setDefaultBtn.textContent = 'Set Default';
            setDefaultBtn.onclick = () => setDefaultCategory(category.id);
            actions.appendChild(setDefaultBtn);
        }

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn btn-small btn-icon';
        deleteBtn.textContent = 'Delete';
        deleteBtn.onclick = () => deleteCategory(category.id);
        actions.appendChild(deleteBtn);

        categoryCard.appendChild(categoryInfo);
        categoryCard.appendChild(badges);
        categoryCard.appendChild(actions);

        categoriesList.appendChild(categoryCard);
    });
}

function renderCategorySelector() {
    if (categories.length === 0) {
        categorySelect.innerHTML = '<option>No categories</option>';
        return;
    }

    const defaultCat = getDefaultCategory();
    categorySelect.innerHTML = '';

    categories.forEach(category => {
        const option = document.createElement('option');
        option.value = category.id;
        option.textContent = category.name;
        if (category.id === defaultCat.id) {
            option.selected = true;
        }
        categorySelect.appendChild(option);
    });
}

function setupColorPicker() {
    const colorOptions = colorPicker.querySelectorAll('.color-option');

    colorOptions.forEach(option => {
        option.addEventListener('click', () => {
            colorOptions.forEach(opt => opt.classList.remove('selected'));
            option.classList.add('selected');
            selectedCategoryColor = option.dataset.color;
            newCategoryColor.value = selectedCategoryColor;
        });
    });

    // Set initial selection
    colorOptions[0].classList.add('selected');
}

function setupDurationSelector() {
    const buttons = durationSelector.querySelectorAll('.duration-btn');

    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            if (isRunning) return; // Don't change duration while timer is running

            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const minutes = parseInt(btn.dataset.minutes);
            workDuration = minutes * 60;
            currentTime = workDuration;
            updateDisplay();
        });
    });
}

function handleAddCategory() {
    const name = newCategoryName.value.trim();
    const color = newCategoryColor.value || selectedCategoryColor;

    if (addCategory(name, color)) {
        newCategoryName.value = '';
        // Reset color picker to first color
        const colorOptions = colorPicker.querySelectorAll('.color-option');
        colorOptions.forEach(opt => opt.classList.remove('selected'));
        colorOptions[0].classList.add('selected');
        selectedCategoryColor = '#0891b2';
        newCategoryColor.value = selectedCategoryColor;
    }
}

// Project Management Functions
async function loadProjects() {
    if (!currentUser) return;
    try {
        const snap = await db.doc(`users/${currentUser.uid}/data/projects`).get();
        if (snap.exists && snap.data().projects) {
            projects = snap.data().projects;
        } else {
            projects = [];
        }
    } catch (err) {
        console.error('Error loading projects:', err);
        projects = [];
    }
}

function saveProjects() {
    if (!currentUser) return Promise.resolve();
    return db.doc(`users/${currentUser.uid}/data/projects`)
        .set({ projects })
        .catch(err => console.error('Error saving projects:', err));
}

function getProjectById(id) {
    return projects.find(p => p.id === id);
}

function addProject(name, categoryId) {
    if (!name || !name.trim()) {
        alert('Please enter a project name');
        return false;
    }

    if (projects.some(p => p.name.toLowerCase() === name.trim().toLowerCase())) {
        alert('A project with this name already exists');
        return false;
    }

    const category = getCategoryById(categoryId);
    if (!category) {
        alert('Please select a valid category');
        return false;
    }

    const newProject = {
        id: generateId(),
        name: name.trim(),
        categoryId: categoryId,
        isCurrent: true,
        isFavourite: false
    };

    projects.push(newProject);
    saveProjects();
    renderProjects();
    renderProjectSelector();
    return true;
}

function deleteProject(id) {
    const project = getProjectById(id);
    if (!project) return false;

    const affectedTasks = tasks.filter(task => task.projectId === id);
    let confirmMsg = `Are you sure you want to delete "${project.name}"?`;
    if (affectedTasks.length > 0) {
        confirmMsg += `\n\n${affectedTasks.length} task(s) will have their project cleared.`;
    }

    if (!confirm(confirmMsg)) return false;

    // Clear project from tasks
    if (affectedTasks.length > 0) {
        tasks.forEach(task => {
            if (task.projectId === id) {
                task.projectId = null;
                task.projectName = null;
            }
        });
        saveAllTasksToFirestore();
        displayTaskHistory();
    }

    // Clear selection if this project was selected
    if (selectedProjectId === id) {
        selectedProjectId = null;
    }

    projects = projects.filter(p => p.id !== id);
    saveProjects();
    renderProjects();
    renderProjectSelector();
    return true;
}

function toggleProjectCurrent(id) {
    const project = getProjectById(id);
    if (!project) return;

    project.isCurrent = !project.isCurrent;
    // If no longer current, also clear favourite
    if (!project.isCurrent) {
        project.isFavourite = false;
    }

    // Clear selection if this project is no longer current
    if (!project.isCurrent && selectedProjectId === id) {
        selectedProjectId = null;
    }

    saveProjects();
    renderProjects();
    renderProjectSelector();
}

function toggleProjectFavourite(id) {
    const project = getProjectById(id);
    if (!project) return;

    project.isFavourite = !project.isFavourite;
    // If marking as favourite, ensure it's also current
    if (project.isFavourite) {
        project.isCurrent = true;
    }

    saveProjects();
    renderProjects();
    renderProjectSelector();
}

// Project UI Functions
function renderProjects() {
    if (projects.length === 0) {
        projectsList.innerHTML = '<p class="empty-state">No projects yet. Add one below!</p>';
        return;
    }

    projectsList.innerHTML = '';

    projects.forEach(project => {
        const category = getCategoryById(project.categoryId);
        const categoryColor = category ? category.color : '#0891b2';
        const categoryName = category ? category.name : 'Unknown';

        const card = document.createElement('div');
        card.className = 'project-card';
        card.style.borderLeftColor = categoryColor;

        const info = document.createElement('div');
        info.className = 'project-info';

        const name = document.createElement('div');
        name.className = 'project-name';
        name.textContent = project.name;

        const catBadge = document.createElement('span');
        catBadge.className = 'project-category-badge';
        catBadge.textContent = categoryName;
        catBadge.style.backgroundColor = categoryColor;

        info.appendChild(name);
        info.appendChild(catBadge);

        const badges = document.createElement('div');
        badges.className = 'project-badges';

        if (project.isCurrent) {
            const currentBadge = document.createElement('span');
            currentBadge.className = 'current-badge';
            currentBadge.textContent = 'Current';
            badges.appendChild(currentBadge);
        }
        if (project.isFavourite) {
            const favBadge = document.createElement('span');
            favBadge.className = 'favourite-badge';
            favBadge.textContent = 'Favourite';
            badges.appendChild(favBadge);
        }

        const actions = document.createElement('div');
        actions.className = 'project-actions';

        const toggleCurrentBtn = document.createElement('button');
        toggleCurrentBtn.className = 'btn btn-small btn-icon';
        toggleCurrentBtn.textContent = project.isCurrent ? 'Archive' : 'Set Current';
        toggleCurrentBtn.onclick = () => toggleProjectCurrent(project.id);
        actions.appendChild(toggleCurrentBtn);

        const toggleFavBtn = document.createElement('button');
        toggleFavBtn.className = 'btn btn-small btn-icon';
        toggleFavBtn.textContent = project.isFavourite ? 'Unfavourite' : 'Favourite';
        toggleFavBtn.onclick = () => toggleProjectFavourite(project.id);
        actions.appendChild(toggleFavBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn btn-small btn-icon';
        deleteBtn.textContent = 'Delete';
        deleteBtn.onclick = () => deleteProject(project.id);
        actions.appendChild(deleteBtn);

        card.appendChild(info);
        card.appendChild(badges);
        card.appendChild(actions);

        projectsList.appendChild(card);
    });
}

function renderNewProjectCategoryDropdown() {
    newProjectCategory.innerHTML = '';
    categories.forEach(category => {
        const option = document.createElement('option');
        option.value = category.id;
        option.textContent = category.name;
        newProjectCategory.appendChild(option);
    });
}

function renderProjectSelector() {
    // Render favourite project chips
    const favourites = projects.filter(p => p.isFavourite);
    projectFavourites.innerHTML = '';

    favourites.forEach(project => {
        const category = getCategoryById(project.categoryId);
        const categoryColor = category ? category.color : '#0891b2';

        const chip = document.createElement('button');
        chip.className = 'project-chip';
        chip.textContent = project.name;
        chip.dataset.projectId = project.id;
        chip.style.borderColor = categoryColor;

        if (selectedProjectId === project.id) {
            chip.classList.add('selected');
            chip.style.backgroundColor = categoryColor;
            chip.style.borderColor = categoryColor;
        }

        chip.addEventListener('click', () => {
            if (selectedProjectId === project.id) {
                // Deselect
                selectedProjectId = null;
                projectSelect.value = '';
            } else {
                // Select this project
                selectedProjectId = project.id;
                projectSelect.value = '';
                // Auto-fill category
                if (project.categoryId) {
                    categorySelect.value = project.categoryId;
                }
            }
            renderProjectSelector();
        });

        projectFavourites.appendChild(chip);
    });

    // Render current (non-favourite) projects in dropdown
    const currentNonFav = projects.filter(p => p.isCurrent && !p.isFavourite);
    projectSelect.innerHTML = '<option value="">No project</option>';

    currentNonFav.forEach(project => {
        const option = document.createElement('option');
        option.value = project.id;
        option.textContent = project.name;
        if (selectedProjectId === project.id) {
            option.selected = true;
        }
        projectSelect.appendChild(option);
    });

    // Hide dropdown if no current non-favourite projects
    projectSelect.style.display = currentNonFav.length > 0 ? '' : 'none';

    // Hide entire selector if no projects at all
    const hasAnyVisible = favourites.length > 0 || currentNonFav.length > 0;
    projectSelector.style.display = hasAnyVisible ? '' : 'none';
}

function setupProjectListeners() {
    addProjectBtn.addEventListener('click', handleAddProject);

    projectSelect.addEventListener('change', () => {
        const value = projectSelect.value;
        if (value) {
            selectedProjectId = value;
            const project = getProjectById(value);
            if (project && project.categoryId) {
                categorySelect.value = project.categoryId;
            }
            // Deselect any favourite chips visually
            renderProjectSelector();
        } else {
            selectedProjectId = null;
            renderProjectSelector();
        }
    });
}

function handleAddProject() {
    const name = newProjectName.value.trim();
    const categoryId = newProjectCategory.value;

    if (addProject(name, categoryId)) {
        newProjectName.value = '';
    }
}

// Task Tracking Functions
function saveTaskToHistory(description, mode, duration, completedAt) {
    const selectedCategory = getCategoryById(categorySelect.value) || getDefaultCategory();

    // Breaks don't inherit the focus session's project
    const selectedProject = (mode !== 'break' && selectedProjectId) ? getProjectById(selectedProjectId) : null;

    const task = {
        id: generateId(),
        description: description,
        mode: mode,
        timestamp: completedAt ? new Date(completedAt).toISOString() : new Date().toISOString(),
        duration: duration,
        category: selectedCategory.id,
        categoryName: selectedCategory.name,
        categoryColor: selectedCategory.color,
        projectId: selectedProject ? selectedProject.id : null,
        projectName: selectedProject ? selectedProject.name : null
    };

    tasks.unshift(task); // Add to beginning of in-memory array (immediate UI update)
    saveTaskToFirestore(task); // Persist to Firestore (async, fire-and-forget)
    displayTaskHistory();
    if (currentView === 'history') renderReport();
}

async function loadTaskHistory() {
    if (!currentUser) return;
    try {
        const snap = await db.collection(`users/${currentUser.uid}/tasks`)
            .orderBy('timestamp', 'desc')
            .get();
        tasks = snap.docs.map(d => d.data());
        displayTaskHistory();
    } catch (err) {
        console.error('Error loading tasks:', err);
        tasks = [];
    }
}

function saveTaskToFirestore(task) {
    if (!currentUser || !task.id) return;
    db.collection(`users/${currentUser.uid}/tasks`)
        .doc(task.id)
        .set(task)
        .catch(err => console.error('Error saving task:', err));
}

// Used when tasks are bulk-modified (e.g. category reassignment after delete)
function saveAllTasksToFirestore() {
    if (!currentUser) return;
    const batch = db.batch();
    tasks.forEach(task => {
        if (!task.id) task.id = generateId();
        const ref = db.collection(`users/${currentUser.uid}/tasks`).doc(task.id);
        batch.set(ref, task);
    });
    batch.commit().catch(err => console.error('Error in bulk task save:', err));
}

function buildTaskSummary(taskArray) {
    const focusTasks = taskArray.filter(t => t.mode === 'work');
    const breakTasks = taskArray.filter(t => t.mode === 'break');
    const focusMins = Math.round(focusTasks.reduce((sum, t) => sum + (t.duration || 0), 0) / 60);
    const breakMins = Math.round(breakTasks.reduce((sum, t) => sum + (t.duration || 0), 0) / 60);
    const parts = [];
    if (focusTasks.length > 0) parts.push(`${focusTasks.length} focus session${focusTasks.length > 1 ? 's' : ''} (${focusMins} min)`);
    if (breakTasks.length > 0) parts.push(`${breakTasks.length} break${breakTasks.length > 1 ? 's' : ''} (${breakMins} min)`);
    return parts.join(', ');
}

function displayTaskHistory() {
    // Only show today's tasks on the Timer page
    const todaysTasks = tasks.filter(task => isToday(task.timestamp));

    if (todaysTasks.length === 0) {
        taskList.innerHTML = '<p class="empty-state">No tasks completed today. Start a focus session!</p>';
        return;
    }

    taskList.innerHTML = '';

    // Show summary for today
    const summary = document.createElement('p');
    summary.className = 'history-summary';
    summary.textContent = buildTaskSummary(todaysTasks);
    taskList.appendChild(summary);

    todaysTasks.forEach(task => {
        const taskItem = createTaskElement(task);
        taskList.appendChild(taskItem);
    });
}

// Date Helper Functions
function isToday(isoString) {
    const taskDate = new Date(isoString);
    const now = new Date();
    return taskDate.getFullYear() === now.getFullYear() &&
           taskDate.getMonth() === now.getMonth() &&
           taskDate.getDate() === now.getDate();
}

function getDateKey(isoString) {
    const date = new Date(isoString);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// ── Reporting / Analytics ─────────────────────────────────────────────────

const reportCharts = { focusByDay: null, byCategory: null, byProject: null };
let reportState = { mode: 'weekly', startDate: null, endDate: null };
let reportPanelInitialized = false;

function initReportPanel() {
    if (reportPanelInitialized) {
        renderReport();
        return;
    }
    reportPanelInitialized = true;

    // Wire range tab buttons
    document.querySelectorAll('.report-range-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.report-range-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            reportState.mode = btn.dataset.range;
            const customRange = document.getElementById('reportCustomRange');
            if (reportState.mode === 'custom') {
                customRange.classList.remove('hidden');
            } else {
                customRange.classList.add('hidden');
                renderReport();
            }
        });
    });

    document.getElementById('reportApplyCustomBtn').addEventListener('click', applyCustomRange);

    // Collapse / expand toggle
    document.getElementById('reportToggleBtn').addEventListener('click', () => {
        const chartsGrid = document.getElementById('reportChartsGrid');
        const statsRow   = document.getElementById('reportStatsRow');
        const btn        = document.getElementById('reportToggleBtn');
        const expanded   = btn.getAttribute('aria-expanded') === 'true';
        chartsGrid.classList.toggle('hidden', expanded);
        statsRow.classList.toggle('hidden', expanded);
        btn.setAttribute('aria-expanded', String(!expanded));
        btn.textContent = expanded ? 'Show Report' : 'Hide Report';
    });

    // Default date values for custom picker
    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 6);
    document.getElementById('reportDateFrom').valueAsDate = sevenDaysAgo;
    document.getElementById('reportDateTo').valueAsDate   = today;

    reportState.mode = 'weekly';
    document.querySelectorAll('.report-range-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.range === 'weekly');
    });

    renderReport();
}

function applyCustomRange() {
    const fromVal = document.getElementById('reportDateFrom').value;
    const toVal   = document.getElementById('reportDateTo').value;
    if (!fromVal || !toVal) return;
    const start = new Date(fromVal + 'T00:00:00');
    const end   = new Date(toVal   + 'T00:00:00');
    if (start > end) {
        alert('Start date must be before end date.');
        return;
    }
    reportState.startDate = start;
    reportState.endDate   = end;
    renderReport();
}

function computeReportRange(mode) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (mode === 'weekly') {
        const start = new Date(today);
        start.setDate(today.getDate() - 6);
        return { start, end: today };
    }
    if (mode === 'monthly') {
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        const end   = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        return { start, end };
    }
    // custom
    return { start: reportState.startDate, end: reportState.endDate };
}

function getTasksInRange(startDate, endDate) {
    const start = startDate.getTime();
    const endDay = new Date(endDate);
    endDay.setDate(endDay.getDate() + 1);
    const end = endDay.getTime();
    return tasks.filter(t => {
        if (t.mode !== 'work') return false;
        const ts = new Date(t.timestamp).getTime();
        return ts >= start && ts < end;
    });
}

function computeSummaryStats(filteredTasks) {
    const totalSeconds = filteredTasks.reduce((sum, t) => sum + (t.duration || 0), 0);
    const totalMins = Math.round(totalSeconds / 60);
    const hours = Math.floor(totalMins / 60);
    const mins  = totalMins % 60;
    const focusTimeLabel = hours > 0
        ? (mins > 0 ? `${hours}h ${mins}m` : `${hours}h`)
        : `${totalMins}m`;
    return { focusTimeLabel, sessionCount: filteredTasks.length };
}

function computeStreaks() {
    const focusDates = new Set(
        tasks.filter(t => t.mode === 'work').map(t => getDateKey(t.timestamp))
    );
    if (focusDates.size === 0) return { currentStreak: 0, longestStreak: 0 };

    const sorted = Array.from(focusDates).sort();

    let longestStreak = 1;
    let runLength = 1;
    for (let i = 1; i < sorted.length; i++) {
        const prev = new Date(sorted[i - 1] + 'T00:00:00');
        const curr = new Date(sorted[i]     + 'T00:00:00');
        const diffDays = (curr - prev) / 86400000;
        if (diffDays === 1) {
            runLength++;
            if (runLength > longestStreak) longestStreak = runLength;
        } else {
            runLength = 1;
        }
    }

    // Current streak: count backwards from today (or yesterday)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayKey = getDateKey(today.toISOString());
    const yest = new Date(today);
    yest.setDate(today.getDate() - 1);
    const yesterdayKey = getDateKey(yest.toISOString());

    let currentStreak = 0;
    if (focusDates.has(todayKey) || focusDates.has(yesterdayKey)) {
        const startDate = focusDates.has(todayKey) ? today : yest;
        currentStreak = 1;
        const check = new Date(startDate);
        check.setDate(check.getDate() - 1);
        while (focusDates.has(getDateKey(check.toISOString()))) {
            currentStreak++;
            check.setDate(check.getDate() - 1);
        }
    }

    return { currentStreak, longestStreak };
}

function computeFocusByDay(startDate, endDate) {
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const labels = [];
    const data   = [];
    const cursor = new Date(startDate);
    while (cursor <= endDate) {
        const key    = getDateKey(cursor.toISOString());
        const dayMin = tasks
            .filter(t => t.mode === 'work' && getDateKey(t.timestamp) === key)
            .reduce((sum, t) => sum + (t.duration || 0), 0) / 60;
        labels.push(`${MONTHS[cursor.getMonth()]} ${cursor.getDate()}`);
        data.push(Math.round(dayMin));
        cursor.setDate(cursor.getDate() + 1);
    }
    return { labels, data };
}

function computeByCategory(filteredTasks) {
    const map = {};
    filteredTasks.forEach(t => {
        if (!map[t.category]) {
            map[t.category] = { name: t.categoryName || 'Unknown', color: t.categoryColor || '#6b7280', totalSeconds: 0 };
        }
        map[t.category].totalSeconds += (t.duration || 0);
    });
    const entries = Object.values(map).sort((a, b) => b.totalSeconds - a.totalSeconds);
    return {
        labels: entries.map(e => e.name),
        data:   entries.map(e => Math.round(e.totalSeconds / 60)),
        colors: entries.map(e => e.color)
    };
}

function computeByProject(filteredTasks, topN = 5) {
    const map = {};
    filteredTasks.forEach(t => {
        if (!t.projectId) return;
        if (!map[t.projectId]) map[t.projectId] = { name: t.projectName || 'Unknown', totalSeconds: 0 };
        map[t.projectId].totalSeconds += (t.duration || 0);
    });
    const entries = Object.values(map).sort((a, b) => b.totalSeconds - a.totalSeconds).slice(0, topN);
    return {
        labels: entries.map(e => e.name),
        data:   entries.map(e => Math.round(e.totalSeconds / 60))
    };
}

function createOrReplaceChart(key, canvasId, config) {
    if (reportCharts[key]) {
        reportCharts[key].destroy();
        reportCharts[key] = null;
    }
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    reportCharts[key] = new Chart(canvas.getContext('2d'), config);
}

function renderReportCharts(filteredTasks, startDate, endDate) {
    // Chart 1: Focus time by day (vertical bar) — always render
    const { labels: dayLabels, data: dayData } = computeFocusByDay(startDate, endDate);
    createOrReplaceChart('focusByDay', 'chartFocusByDay', {
        type: 'bar',
        data: {
            labels: dayLabels,
            datasets: [{
                label: 'Focus (min)',
                data: dayData,
                backgroundColor: 'rgba(8, 145, 178, 0.7)',
                borderColor: '#0891b2',
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, title: { display: true, text: 'Minutes' } },
                x: { grid: { display: false } }
            }
        }
    });

    // Chart 2: By category (doughnut)
    const wrapCat = document.getElementById('wrapByCategory');
    if (filteredTasks.length === 0) {
        if (reportCharts.byCategory) { reportCharts.byCategory.destroy(); reportCharts.byCategory = null; }
        wrapCat.innerHTML = '<p class="empty-state">No focus sessions in this range.</p>';
    } else {
        wrapCat.innerHTML = '<canvas id="chartByCategory"></canvas>';
        const { labels: catLabels, data: catData, colors } = computeByCategory(filteredTasks);
        createOrReplaceChart('byCategory', 'chartByCategory', {
            type: 'doughnut',
            data: {
                labels: catLabels,
                datasets: [{ data: catData, backgroundColor: colors, borderWidth: 2, borderColor: '#ffffff' }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } },
                    tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed} min` } }
                }
            }
        });
    }

    // Chart 3: By project (horizontal bar)
    const wrapProj = document.getElementById('wrapByProject');
    const tasksWithProjects = filteredTasks.filter(t => t.projectId);
    if (tasksWithProjects.length === 0) {
        if (reportCharts.byProject) { reportCharts.byProject.destroy(); reportCharts.byProject = null; }
        wrapProj.innerHTML = '<p class="empty-state">No project-tagged sessions in this range.</p>';
    } else {
        wrapProj.innerHTML = '<canvas id="chartByProject"></canvas>';
        const { labels: projLabels, data: projData } = computeByProject(filteredTasks);
        createOrReplaceChart('byProject', 'chartByProject', {
            type: 'bar',
            data: {
                labels: projLabels,
                datasets: [{
                    label: 'Focus (min)',
                    data: projData,
                    backgroundColor: 'rgba(139, 92, 246, 0.7)',
                    borderColor: '#8b5cf6',
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: true,
                plugins: { legend: { display: false } },
                scales: {
                    x: { beginAtZero: true, title: { display: true, text: 'Minutes' } },
                    y: { grid: { display: false } }
                }
            }
        });
    }
}

function renderReport() {
    const { start, end } = computeReportRange(reportState.mode);
    if (!start || !end) return;

    reportState.startDate = start;
    reportState.endDate   = end;

    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    document.getElementById('reportRangeLabel').textContent =
        `${MONTHS[start.getMonth()]} ${start.getDate()} – ${MONTHS[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;

    const filtered = getTasksInRange(start, end);
    const { focusTimeLabel, sessionCount } = computeSummaryStats(filtered);
    const { currentStreak, longestStreak }  = computeStreaks();

    document.getElementById('reportTotalFocusTime').textContent = focusTimeLabel || '0m';
    document.getElementById('reportTotalSessions').textContent  = sessionCount;
    document.getElementById('reportCurrentStreak').textContent  = currentStreak + (currentStreak === 1 ? ' day' : ' days');
    document.getElementById('reportLongestStreak').textContent  = longestStreak + (longestStreak === 1 ? ' day' : ' days');

    renderReportCharts(filtered, start, end);
}

// ── End Reporting ─────────────────────────────────────────────────────────

function createTaskElement(task) {
    const taskItem = document.createElement('div');
    taskItem.className = `task-item ${task.mode === 'break' ? 'break-task' : ''}`;

    const taskHeader = document.createElement('div');
    taskHeader.className = 'task-item-header';

    const taskDescription = document.createElement('div');
    taskDescription.className = 'task-description';
    taskDescription.textContent = task.description;

    const badges = document.createElement('div');
    badges.className = 'task-badges';

    const taskMode = document.createElement('span');
    taskMode.className = `task-mode ${task.mode === 'break' ? 'break-task' : ''}`;
    taskMode.textContent = task.mode === 'work' ? 'Focus' : 'Break';
    badges.appendChild(taskMode);

    // Add category and project badges for focus sessions only
    if (task.mode !== 'break') {
        if (task.category && task.categoryName) {
            const categoryBadge = document.createElement('span');
            categoryBadge.className = 'task-category-badge';
            categoryBadge.textContent = task.categoryName;
            categoryBadge.style.backgroundColor = task.categoryColor || '#0891b2';
            badges.appendChild(categoryBadge);
        }

        if (task.projectId && task.projectName) {
            const projectBadge = document.createElement('span');
            projectBadge.className = 'task-project-badge';
            const projectColor = task.categoryColor || '#0891b2';
            projectBadge.textContent = task.projectName;
            projectBadge.style.borderColor = projectColor;
            projectBadge.style.color = projectColor;
            badges.appendChild(projectBadge);
        }
    }

    // Note toggle button — pencil icon, highlighted when a note exists
    const noteBtn = document.createElement('button');
    noteBtn.className = 'note-btn' + (task.note ? ' has-note' : '');
    noteBtn.title = task.note ? 'View/edit note' : 'Add note';
    noteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>`;

    taskHeader.appendChild(taskDescription);
    taskHeader.appendChild(badges);
    taskHeader.appendChild(noteBtn);

    const taskMetadata = document.createElement('div');
    taskMetadata.className = 'task-metadata';

    const timestamp = document.createElement('span');
    const endTs = new Date(task.timestamp);
    const startTs = new Date(endTs.getTime() - (task.duration || 0) * 1000);
    timestamp.textContent = `${formatClockTime(startTs)} – ${formatClockTime(endTs)}`;

    const duration = document.createElement('span');
    duration.textContent = `Duration: ${formatDuration(task.duration)}`;

    taskMetadata.appendChild(timestamp);
    taskMetadata.appendChild(duration);

    // ── Note panel (hidden until noteBtn is clicked) ──────────────────────────
    const notePanel = document.createElement('div');
    notePanel.className = 'task-note-panel';

    const noteTextarea = document.createElement('textarea');
    noteTextarea.className = 'task-note-textarea';
    noteTextarea.placeholder = 'Add a note about this session...';
    noteTextarea.value = task.note || '';

    const noteActions = document.createElement('div');
    noteActions.className = 'note-actions';

    const noteSaveBtn = document.createElement('button');
    noteSaveBtn.className = 'btn btn-small';
    noteSaveBtn.textContent = 'Save';

    const noteCancelBtn = document.createElement('button');
    noteCancelBtn.className = 'btn btn-small btn-secondary';
    noteCancelBtn.textContent = 'Cancel';

    noteActions.appendChild(noteSaveBtn);
    noteActions.appendChild(noteCancelBtn);
    notePanel.appendChild(noteTextarea);
    notePanel.appendChild(noteActions);

    noteBtn.addEventListener('click', () => {
        const isOpen = notePanel.classList.contains('open');
        if (isOpen) {
            notePanel.classList.remove('open');
        } else {
            noteTextarea.value = task.note || '';
            notePanel.classList.add('open');
            noteTextarea.focus();
        }
    });

    noteSaveBtn.addEventListener('click', () => {
        const text = noteTextarea.value.trim();
        task.note = text;
        noteBtn.classList.toggle('has-note', !!text);
        noteBtn.title = text ? 'View/edit note' : 'Add note';
        saveTaskNote(task.id, text);
        notePanel.classList.remove('open');
    });

    noteCancelBtn.addEventListener('click', () => {
        noteTextarea.value = task.note || '';
        notePanel.classList.remove('open');
    });
    // ─────────────────────────────────────────────────────────────────────────

    taskItem.appendChild(taskHeader);
    taskItem.appendChild(taskMetadata);
    taskItem.appendChild(notePanel);

    return taskItem;
}

function saveTaskNote(taskId, note) {
    if (!currentUser || !taskId) return;
    const taskInMemory = tasks.find(t => t.id === taskId);
    if (taskInMemory) taskInMemory.note = note;
    db.collection(`users/${currentUser.uid}/tasks`)
        .doc(taskId)
        .update({ note })
        .catch(err => console.error('Error saving note:', err));
}

function formatClockTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// History View Functions
function getAvailableDates() {
    const dateSet = new Set();
    tasks.forEach(task => {
        if (!isToday(task.timestamp)) {
            dateSet.add(getDateKey(task.timestamp));
        }
    });
    // Sort most recent first
    return Array.from(dateSet).sort((a, b) => b.localeCompare(a));
}

function initHistoryView() {
    const dates = getAvailableDates();

    if (dates.length === 0) {
        dateSelectorBar.innerHTML = '';
        historyTaskList.innerHTML = '<p class="empty-state">No past task history yet.</p>';
        return;
    }

    // Auto-select the most recent past date
    renderDateSelector(dates, dates[0]);
    displayHistoryTasks(dates[0]);
}

function renderDateSelector(dates, selectedDate) {
    dateSelectorBar.innerHTML = '';

    dates.forEach(dateKey => {
        const chip = document.createElement('button');
        chip.className = `date-chip${dateKey === selectedDate ? ' active' : ''}`;
        chip.textContent = formatDateChip(dateKey);
        chip.addEventListener('click', () => {
            renderDateSelector(dates, dateKey);
            displayHistoryTasks(dateKey);
        });
        dateSelectorBar.appendChild(chip);
    });
}

function displayHistoryTasks(dateKey) {
    const dateTasks = tasks.filter(task => getDateKey(task.timestamp) === dateKey);

    historyTaskList.innerHTML = '';

    if (dateTasks.length === 0) {
        historyTaskList.innerHTML = '<p class="empty-state">No tasks for this date.</p>';
        return;
    }

    // Show summary
    const summary = document.createElement('p');
    summary.className = 'history-summary';
    summary.textContent = buildTaskSummary(dateTasks);
    historyTaskList.appendChild(summary);

    // Render tasks
    dateTasks.forEach(task => {
        const taskItem = createTaskElement(task);
        historyTaskList.appendChild(taskItem);
    });
}

function formatDateChip(dateKey) {
    const [year, month, day] = dateKey.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    const now = new Date();

    // Check if yesterday
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.getFullYear() === yesterday.getFullYear() &&
        date.getMonth() === yesterday.getMonth() &&
        date.getDate() === yesterday.getDate()) {
        return 'Yesterday';
    }

    // Format as "Day, Mon DD" (e.g., "Thu, Feb 6")
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
}

async function clearTaskHistory() {
    if (tasks.length === 0) {
        return;
    }

    if (confirm('Are you sure you want to clear all task history? This cannot be undone.')) {
        // Delete all task docs from Firestore
        if (currentUser) {
            try {
                const snap = await db.collection(`users/${currentUser.uid}/tasks`).get();
                const batch = db.batch();
                snap.docs.forEach(d => batch.delete(d.ref));
                await batch.commit();
            } catch (err) {
                console.error('Error clearing tasks from Firestore:', err);
            }
        }
        tasks = [];
        displayTaskHistory();
        // Also refresh history view if it's visible
        if (currentView === 'history') {
            initHistoryView();
            renderReport();
        }
    }
}

// Initialize the app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
