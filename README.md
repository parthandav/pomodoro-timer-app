# Pomodoro Timer Web App

A simple, elegant web-based Pomodoro timer to help you stay focused and productive. Built with vanilla HTML, CSS, and JavaScript.

## Features

### Timer Functionality
- **Work Sessions**: 25-minute focused work periods
- **Break Sessions**: 5-minute rest periods
- **Easy Controls**: Start, pause, reset, and switch between modes
- **Visual Feedback**: Color-coded modes (teal for work, green for breaks)
- **Browser Tab Updates**: See remaining time in your browser tab while working

### Task Tracking
- **Task Input**: Enter what you're working on before starting a session
- **Session History**: View all completed Pomodoro sessions
- **Persistent Storage**: Your task history is saved locally and persists across browser sessions
- **Task Details**: Each entry shows:
  - Task description
  - Session type (Focus/Break)
  - Category with color-coded badge
  - When it was completed
  - Session duration
- **Clear History**: Remove all task history when needed

### Category Management
- **Organize Tasks**: Categorize your work sessions for better tracking
- **Default Categories**: Comes with "Work" and "Learn" categories pre-configured
- **Category Selector**: Choose a category when entering tasks (defaults to your preferred category)
- **Custom Categories**: Create unlimited custom categories with personalized colors
- **Category Colors**: Choose from 6 pre-defined color options for visual organization
- **Set Default**: Mark any category as default for quick task entry
- **Delete Protection**: Prevents deletion of the last category; reassigns tasks when deleting
- **Visual Feedback**: Color-coded badges in task history for easy identification
- **Separate Management View**: Dedicated interface for managing all categories

### User Experience
- **Clean, Minimal Design**: Focus on what matters - your work
- **Responsive Layout**: Works seamlessly on desktop, tablet, and mobile
- **Audio Notification**: Subtle sound alert when a session completes
- **Input Validation**: Ensures you enter a task before starting work sessions
- **Accessible**: Proper ARIA labels and semantic HTML

## How to Use

### Installation
1. Download or clone this repository
2. Open `index.html` in any modern web browser
3. That's it! No installation or build process required

### Using the Timer
1. **Select Category**: Choose a category from the dropdown (defaults to your preferred category)
2. **Enter Your Task**: Type what you'll be working on in the input field
3. **Start Working**: Click the "Start" button to begin your 25-minute focus session
4. **Take Breaks**: When the timer completes, switch to Break mode for a 5-minute rest
5. **Track Progress**: View your completed sessions in the Task History section with category badges

### Managing Categories
1. **Navigate to Categories**: Click the "Categories" button in the header navigation
2. **Add New Category**:
   - Enter a category name (e.g., "Project", "Study", "Exercise")
   - Select a color from the color picker
   - Click "Add Category"
3. **Set Default**: Click "Set Default" on any category to make it the automatic selection
4. **Delete Category**: Click "Delete" to remove a category (tasks will be reassigned to default)
5. **Return to Timer**: Click the "Timer" button to continue working

### Controls
- **Start/Pause**: Begin or pause the current timer
- **Reset**: Reset the current session to its full duration
- **Switch Mode**: Toggle between Focus and Break modes
- **Clear History**: Remove all saved task history
- **Timer/Categories**: Navigate between timer and category management views

## Technologies Used

- **HTML5**: Semantic markup structure
- **CSS3**: Modern styling with CSS variables and flexbox
- **JavaScript (ES6+)**: Vanilla JavaScript for all functionality
- **localStorage API**: Client-side persistence for task history
- **Web Audio API**: Audio notifications for session completion

## Browser Compatibility

Works in all modern browsers:
- Chrome/Edge (recommended)
- Firefox
- Safari
- Opera

Requires JavaScript and localStorage to be enabled.

## About the Pomodoro Technique

The Pomodoro Technique is a time management method developed by Francesco Cirillo. It uses a timer to break work into intervals (traditionally 25 minutes) separated by short breaks. These intervals are called "pomodoros."

**Basic Steps:**
1. Choose a task
2. Set the timer to 25 minutes
3. Work on the task until the timer rings
4. Take a short 5-minute break
5. After 4 pomodoros, take a longer break (15-30 minutes)

Learn more: [Wikipedia - Pomodoro Technique](https://en.wikipedia.org/wiki/Pomodoro_Technique)

## Project Structure

```
PomodoroWebApp/
├── index.html          # Main HTML structure with timer and categories views
├── style.css           # All styling and responsive layout
├── app.js              # Timer logic, category management, and task tracking
├── .gitignore          # Git ignore patterns
└── README.md           # This file
```

## Future Enhancements

Potential features for future versions:
- Customizable timer durations
- Long break intervals after multiple sessions (e.g., 15-30 min after 4 pomodoros)
- Statistics and analytics dashboard
- Export task history (CSV/JSON)
- Category-based time tracking reports
- Keyboard shortcuts for common actions
- Dark mode toggle
- Custom notification sounds
- Project entity to organize tasks within categories

## License

This project is open source and available for personal and educational use.

## Credits

Built with vanilla JavaScript as a learning project and productivity tool.
