// Timer State
const WORK_DURATION = 25 * 60; // 25 minutes in seconds
const BREAK_DURATION = 5 * 60; // 5 minutes in seconds

let currentTime = WORK_DURATION;
let timerInterval = null;
let isRunning = false;
let currentMode = 'work'; // 'work' or 'break'
let endTime = null; // Timestamp when timer should reach 0
let tasks = [];

// DOM Elements
const timerDisplay = document.getElementById('timerDisplay');
const startPauseBtn = document.getElementById('startPauseBtn');
const resetBtn = document.getElementById('resetBtn');
const switchModeBtn = document.getElementById('switchModeBtn');
const modeIndicator = document.getElementById('modeIndicator');
const taskInput = document.getElementById('taskInput');
const taskList = document.getElementById('taskList');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');

// Initialize app
function init() {
    loadTaskHistory();
    updateDisplay();
    setupEventListeners();
}

// Event Listeners
function setupEventListeners() {
    startPauseBtn.addEventListener('click', toggleTimer);
    resetBtn.addEventListener('click', resetTimer);
    switchModeBtn.addEventListener('click', switchMode);
    clearHistoryBtn.addEventListener('click', clearTaskHistory);
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
    // Validation: Check if task is entered for work mode
    if (currentMode === 'work' && !taskInput.value.trim()) {
        alert('Please enter what you\'re working on before starting the timer!');
        taskInput.focus();
        return;
    }

    isRunning = true;
    startPauseBtn.textContent = 'Pause';
    startPauseBtn.classList.add('active');

    // Calculate target end time based on current remaining time
    endTime = Date.now() + (currentTime * 1000);

    timerInterval = setInterval(() => {
        // Calculate remaining time based on actual elapsed time
        const remainingMs = endTime - Date.now();
        currentTime = Math.max(0, Math.ceil(remainingMs / 1000));

        updateDisplay();
        updateTabTitle();

        if (currentTime <= 0) {
            timerComplete();
        }
    }, 100); // Check more frequently (every 100ms) for better accuracy
}

function pauseTimer() {
    isRunning = false;
    startPauseBtn.textContent = 'Start';
    startPauseBtn.classList.remove('active');
    clearInterval(timerInterval);

    // Calculate and save the actual remaining time when pausing
    if (endTime !== null) {
        const remainingMs = endTime - Date.now();
        currentTime = Math.max(0, Math.ceil(remainingMs / 1000));
        endTime = null;
    }

    updateDisplay();
    document.title = 'Pomodoro Timer';
}

function resetTimer() {
    pauseTimer();
    endTime = null;
    currentTime = currentMode === 'work' ? WORK_DURATION : BREAK_DURATION;
    updateDisplay();
    document.title = 'Pomodoro Timer';
}

function switchMode() {
    pauseTimer();

    if (currentMode === 'work') {
        currentMode = 'break';
        currentTime = BREAK_DURATION;
        modeIndicator.textContent = 'Break Mode';
        modeIndicator.classList.add('break-mode');
        timerDisplay.classList.add('break-mode');
        startPauseBtn.classList.add('break-mode');
        switchModeBtn.textContent = 'Switch to Work';
    } else {
        currentMode = 'work';
        currentTime = WORK_DURATION;
        modeIndicator.textContent = 'Work Mode';
        modeIndicator.classList.remove('break-mode');
        timerDisplay.classList.remove('break-mode');
        startPauseBtn.classList.remove('break-mode');
        switchModeBtn.textContent = 'Switch to Break';
    }

    updateDisplay();
    document.title = 'Pomodoro Timer';
}

function timerComplete() {
    pauseTimer();

    // Play completion sound (if implemented)
    playCompletionSound();

    // Save task to history if it's a work session
    if (currentMode === 'work') {
        const taskDescription = taskInput.value.trim() || 'Untitled Task';
        saveTaskToHistory(taskDescription, currentMode, WORK_DURATION);
        taskInput.value = ''; // Clear input after completion
    } else {
        saveTaskToHistory('Break', currentMode, BREAK_DURATION);
    }

    // Show completion message
    alert(`${currentMode === 'work' ? 'Work' : 'Break'} session complete! Great job!`);

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

function updateTabTitle() {
    if (isRunning) {
        document.title = `${formatTime(currentTime)} - ${currentMode === 'work' ? 'Work' : 'Break'}`;
    }
}

function playCompletionSound() {
    // Optional: Create a simple beep using Web Audio API
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.value = 800;
        oscillator.type = 'sine';

        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.5);
    } catch (error) {
        console.log('Audio playback not supported');
    }
}

// Task Tracking Functions
function saveTaskToHistory(description, mode, duration) {
    const task = {
        description: description,
        mode: mode,
        timestamp: new Date().toISOString(),
        duration: duration
    };

    tasks.unshift(task); // Add to beginning of array
    saveTasksToLocalStorage();
    displayTaskHistory();
}

function loadTaskHistory() {
    const storedTasks = localStorage.getItem('pomodoroTasks');
    if (storedTasks) {
        try {
            tasks = JSON.parse(storedTasks);
            displayTaskHistory();
        } catch (error) {
            console.error('Error loading tasks from localStorage:', error);
            tasks = [];
        }
    }
}

function saveTasksToLocalStorage() {
    try {
        localStorage.setItem('pomodoroTasks', JSON.stringify(tasks));
    } catch (error) {
        console.error('Error saving tasks to localStorage:', error);
    }
}

function displayTaskHistory() {
    if (tasks.length === 0) {
        taskList.innerHTML = '<p class="empty-state">No tasks completed yet. Start a timer to begin!</p>';
        return;
    }

    taskList.innerHTML = '';

    tasks.forEach(task => {
        const taskItem = createTaskElement(task);
        taskList.appendChild(taskItem);
    });
}

function createTaskElement(task) {
    const taskItem = document.createElement('div');
    taskItem.className = `task-item ${task.mode === 'break' ? 'break-task' : ''}`;

    const taskHeader = document.createElement('div');
    taskHeader.className = 'task-item-header';

    const taskDescription = document.createElement('div');
    taskDescription.className = 'task-description';
    taskDescription.textContent = task.description;

    const taskMode = document.createElement('span');
    taskMode.className = `task-mode ${task.mode === 'break' ? 'break-task' : ''}`;
    taskMode.textContent = task.mode === 'work' ? 'Work' : 'Break';

    taskHeader.appendChild(taskDescription);
    taskHeader.appendChild(taskMode);

    const taskMetadata = document.createElement('div');
    taskMetadata.className = 'task-metadata';

    const timestamp = document.createElement('span');
    timestamp.textContent = formatTimestamp(task.timestamp);

    const duration = document.createElement('span');
    duration.textContent = `Duration: ${task.duration / 60} min`;

    taskMetadata.appendChild(timestamp);
    taskMetadata.appendChild(duration);

    taskItem.appendChild(taskHeader);
    taskItem.appendChild(taskMetadata);

    return taskItem;
}

function formatTimestamp(isoString) {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) {
        return 'Just now';
    } else if (diffMins < 60) {
        return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
    } else if (diffHours < 24) {
        return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    } else if (diffDays < 7) {
        return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    } else {
        return date.toLocaleDateString();
    }
}

function clearTaskHistory() {
    if (tasks.length === 0) {
        return;
    }

    if (confirm('Are you sure you want to clear all task history? This cannot be undone.')) {
        tasks = [];
        saveTasksToLocalStorage();
        displayTaskHistory();
    }
}

// Initialize the app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
