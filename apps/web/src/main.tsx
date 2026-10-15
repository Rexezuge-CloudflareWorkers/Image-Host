import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

const container = document.querySelector('#root');
if (!container) {
  throw new Error('Missing #root. Check index.html.');
}

ReactDOM.createRoot(container).render(<App />);
