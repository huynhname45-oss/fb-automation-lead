// Launcher for standalone executable
import('./server.js').catch(err => {
  console.error('Failed to start server:', err);
});
