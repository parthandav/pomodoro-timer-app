// Timer State
const WORK_DURATION = 25 * 60; // 25 minutes in seconds

let currentTime = WORK_DURATION;
let timerInterval = null;
let isRunning = false;
let currentMode = 'work'; // 'work' or 'break'
let endTime = null; // Timestamp when timer should reach 0
let breakStartTime = null; // Timestamp when break started (for open-ended breaks)
let isBreakActive = false; // Whether a break is currently in progress
let timerWorker = null; // Web Worker for background timer (not throttled by browser)
let tasks = [];

// Categories State
let categories = [];
let currentView = 'timer'; // 'timer', 'categories', or 'history'
let selectedCategoryColor = '#0891b2'; // Default blue color

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

// Navigation Elements
const timerNavBtn = document.getElementById('timerNavBtn');
const categoriesNavBtn = document.getElementById('categoriesNavBtn');
const historyNavBtn = document.getElementById('historyNavBtn');
const timerView = document.getElementById('timerView');
const categoriesView = document.getElementById('categoriesView');
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

// Initialize app
function init() {
    loadCategories();
    loadTaskHistory();
    updateDisplay();
    renderCategorySelector();
    setupEventListeners();
    setupNavigation();
    setupColorPicker();
    requestNotificationPermission();
    setupVisibilityHandler();
}

// Request notification permission on page load
function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

// Web Worker for reliable background timer (browsers throttle setInterval in background tabs)
function createTimerWorker() {
    const workerCode = `
        let timerId = null;
        self.onmessage = function(e) {
            if (e.data.type === 'start') {
                if (timerId) clearInterval(timerId);
                const endTime = e.data.endTime;
                timerId = setInterval(function() {
                    if (Date.now() >= endTime) {
                        clearInterval(timerId);
                        timerId = null;
                        self.postMessage({ type: 'complete' });
                    }
                }, 500);
            } else if (e.data.type === 'stop') {
                if (timerId) {
                    clearInterval(timerId);
                    timerId = null;
                }
            }
        };
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    return new Worker(URL.createObjectURL(blob));
}

function stopTimerWorker() {
    if (timerWorker) {
        timerWorker.postMessage({ type: 'stop' });
        timerWorker.terminate();
        timerWorker = null;
    }
}

// Visibility change handler - catches timer completion when tab becomes visible
function setupVisibilityHandler() {
    document.addEventListener('visibilitychange', () => {
        if (document.hidden || !isRunning) return;

        if (currentMode === 'work' && endTime) {
            const remainingMs = endTime - Date.now();
            if (remainingMs <= 0) {
                timerComplete();
            } else {
                currentTime = Math.max(0, Math.ceil(remainingMs / 1000));
                updateDisplay();
                updateTabTitle();
            }
        } else if (currentMode === 'break' && breakStartTime) {
            const elapsedMs = Date.now() - breakStartTime;
            currentTime = Math.floor(elapsedMs / 1000);
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
    // Validation: Check if task is entered for work mode
    if (currentMode === 'work' && !taskInput.value.trim()) {
        alert('Please enter what you\'re working on before starting the timer!');
        taskInput.focus();
        return;
    }

    isRunning = true;

    if (currentMode === 'break') {
        // Break mode: count UP (elapsed time)
        // Break auto-starts when switching to break mode, so breakStartTime is already set
        if (!isBreakActive) {
            isBreakActive = true;
            breakStartTime = Date.now();
        }

        // Hide start/pause button during break (breaks don't pause)
        startPauseBtn.style.display = 'none';

        timerInterval = setInterval(() => {
            const elapsedMs = Date.now() - breakStartTime;
            currentTime = Math.floor(elapsedMs / 1000);
            updateDisplay();
            updateTabTitle();
        }, 100);
    } else {
        // Focus mode: count DOWN (remaining time)
        startPauseBtn.textContent = 'Pause';
        startPauseBtn.classList.add('active');

        // Calculate target end time based on current remaining time
        endTime = Date.now() + (currentTime * 1000);

        // Start Web Worker for reliable background completion
        // (browsers throttle setInterval in background tabs, but Workers are not throttled)
        stopTimerWorker();
        try {
            timerWorker = createTimerWorker();
            timerWorker.onmessage = (e) => {
                if (e.data.type === 'complete') {
                    timerComplete();
                }
            };
            timerWorker.postMessage({ type: 'start', endTime: endTime });
        } catch (err) {
            console.log('Web Worker not available, using fallback timer');
        }

        timerInterval = setInterval(() => {
            // Calculate remaining time based on actual elapsed time
            const remainingMs = endTime - Date.now();
            currentTime = Math.max(0, Math.ceil(remainingMs / 1000));

            updateDisplay();
            updateTabTitle();

            if (currentTime <= 0) {
                timerComplete();
            }
        }, 100);
    }
}

function pauseTimer() {
    isRunning = false;
    clearInterval(timerInterval);
    stopTimerWorker();

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
        currentTime = WORK_DURATION;
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
        currentTime = WORK_DURATION;
        modeIndicator.textContent = 'Focus Mode';
        modeIndicator.classList.remove('break-mode');
        timerDisplay.classList.remove('break-mode');
        startPauseBtn.classList.remove('break-mode');
        startPauseBtn.style.display = ''; // Show start button again
        switchModeBtn.textContent = 'Switch to Break';

        updateDisplay();
        document.title = 'Pomodoro Timer';
    }
}

function timerComplete() {
    // Breaks never auto-complete - they run until user switches to focus
    if (currentMode === 'break') return;

    // Guard against double-firing (Worker + interval can both trigger this)
    if (!isRunning && currentTime > 0) return;

    pauseTimer();

    // Play completion sound
    playCompletionSound();

    // Save focus session to history
    const completedTaskName = taskInput.value.trim() || 'Untitled Task';
    saveTaskToHistory(completedTaskName, currentMode, WORK_DURATION);
    taskInput.value = ''; // Clear input after completion

    // Show browser notification
    showNotification(
        'Focus Complete!',
        `Great job! You completed: ${completedTaskName}`
    );

    // Also show alert as fallback
    alert('Focus session complete! Great job!');

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
    historyNavBtn.addEventListener('click', () => showView('history'));
    clearAllHistoryBtn.addEventListener('click', clearTaskHistory);
}

function showView(viewName) {
    currentView = viewName;

    // Hide all views
    timerView.classList.add('hidden');
    categoriesView.classList.add('hidden');
    historyView.classList.add('hidden');

    // Deactivate all nav buttons
    timerNavBtn.classList.remove('active');
    categoriesNavBtn.classList.remove('active');
    historyNavBtn.classList.remove('active');

    // Show selected view
    if (viewName === 'timer') {
        timerView.classList.remove('hidden');
        timerNavBtn.classList.add('active');
    } else if (viewName === 'categories') {
        categoriesView.classList.remove('hidden');
        categoriesNavBtn.classList.add('active');
        renderCategories();
    } else if (viewName === 'history') {
        historyView.classList.remove('hidden');
        historyNavBtn.classList.add('active');
        initHistoryView();
    }
}

// Category Management Functions
function loadCategories() {
    const storedCategories = localStorage.getItem('pomodoroCategories');
    if (storedCategories) {
        try {
            categories = JSON.parse(storedCategories);
        } catch (error) {
            console.error('Error loading categories:', error);
            createDefaultCategories();
        }
    } else {
        createDefaultCategories();
    }
}

function createDefaultCategories() {
    categories = [
        { id: generateId(), name: 'Work', isDefault: true, color: '#0891b2' },
        { id: generateId(), name: 'Learn', isDefault: false, color: '#8b5cf6' }
    ];
    saveCategories();
}

function saveCategories() {
    try {
        localStorage.setItem('pomodoroCategories', JSON.stringify(categories));
    } catch (error) {
        console.error('Error saving categories:', error);
    }
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
        saveTasksToLocalStorage();
        displayTaskHistory();
    }

    // If deleting the default category, set a new default
    if (category.isDefault && categories.length > 1) {
        const remainingCategories = categories.filter(cat => cat.id !== id);
        remainingCategories[0].isDefault = true;
    }

    categories = categories.filter(cat => cat.id !== id);
    saveCategories();
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

// Task Tracking Functions
function saveTaskToHistory(description, mode, duration) {
    const selectedCategory = getCategoryById(categorySelect.value) || getDefaultCategory();

    const task = {
        description: description,
        mode: mode,
        timestamp: new Date().toISOString(),
        duration: duration,
        category: selectedCategory.id,
        categoryName: selectedCategory.name,
        categoryColor: selectedCategory.color
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
            migrateTasksToCategories();
            displayTaskHistory();
        } catch (error) {
            console.error('Error loading tasks from localStorage:', error);
            tasks = [];
        }
    }
}

function migrateTasksToCategories() {
    let needsSave = false;
    const defaultCat = getDefaultCategory();

    tasks.forEach(task => {
        if (!task.category || !task.categoryName) {
            task.category = defaultCat.id;
            task.categoryName = defaultCat.name;
            task.categoryColor = defaultCat.color;
            needsSave = true;
        }
    });

    if (needsSave) {
        saveTasksToLocalStorage();
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
    // Only show today's tasks on the Timer page
    const todaysTasks = tasks.filter(task => isToday(task.timestamp));

    if (todaysTasks.length === 0) {
        taskList.innerHTML = '<p class="empty-state">No tasks completed today. Start a focus session!</p>';
        return;
    }

    taskList.innerHTML = '';

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

    // Add category badge if available
    if (task.category && task.categoryName) {
        const categoryBadge = document.createElement('span');
        categoryBadge.className = 'task-category-badge';
        categoryBadge.textContent = task.categoryName;
        categoryBadge.style.backgroundColor = task.categoryColor || '#0891b2';
        badges.appendChild(categoryBadge);
    }

    taskHeader.appendChild(taskDescription);
    taskHeader.appendChild(badges);

    const taskMetadata = document.createElement('div');
    taskMetadata.className = 'task-metadata';

    const timestamp = document.createElement('span');
    timestamp.textContent = formatTimestamp(task.timestamp);

    const duration = document.createElement('span');
    duration.textContent = `Duration: ${formatDuration(task.duration)}`;

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
    const focusCount = dateTasks.filter(t => t.mode === 'work').length;
    const breakCount = dateTasks.filter(t => t.mode === 'break').length;
    const parts = [];
    if (focusCount > 0) parts.push(`${focusCount} focus session${focusCount > 1 ? 's' : ''}`);
    if (breakCount > 0) parts.push(`${breakCount} break${breakCount > 1 ? 's' : ''}`);
    summary.textContent = parts.join(', ');
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

function clearTaskHistory() {
    if (tasks.length === 0) {
        return;
    }

    if (confirm('Are you sure you want to clear all task history? This cannot be undone.')) {
        tasks = [];
        saveTasksToLocalStorage();
        displayTaskHistory();
        // Also refresh history view if it's visible
        if (currentView === 'history') {
            initHistoryView();
        }
    }
}

// Initialize the app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
