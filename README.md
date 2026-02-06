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
  - Session type (Work/Break)
  - When it was completed
  - Session duration
- **Clear History**: Remove all task history when needed

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
1. **Enter Your Task**: Type what you'll be working on in the input field
2. **Start Working**: Click the "Start" button to begin your 25-minute work session
3. **Take Breaks**: When the timer completes, switch to Break mode for a 5-minute rest
4. **Track Progress**: View your completed sessions in the Task History section

### Controls
- **Start/Pause**: Begin or pause the current timer
- **Reset**: Reset the current session to its full duration
- **Switch Mode**: Toggle between Work and Break modes
- **Clear History**: Remove all saved task history

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
├── index.html          # Main HTML structure
├── style.css           # All styling and layout
├── app.js              # Timer logic and task tracking
└── README.md           # This file
```

## Future Enhancements

Potential features for future versions:
- Customizable timer durations
- Long break intervals after multiple sessions
- Statistics and analytics
- Export task history
- Keyboard shortcuts
- Dark mode
- Notification API integration
- Sound selection

## License

This project is open source and available for personal and educational use.

## Credits

Built with vanilla JavaScript as a learning project and productivity tool.
