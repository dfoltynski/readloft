import { Route, Routes, useLocation } from 'react-router-dom';
import LibraryPage from './pages/LibraryPage';
import BookPage from './pages/BookPage';
import ReaderPage from './pages/ReaderPage';
import NightLightOverlay from './components/NightLightOverlay';

export default function App() {
  const { pathname } = useLocation();
  return (
    <>
      <Routes>
        <Route path="/" element={<LibraryPage />} />
        <Route path="/shelf/:id" element={<LibraryPage />} />
        <Route path="/book/:id" element={<BookPage />} />
        <Route path="/read/:id" element={<ReaderPage />} />
        <Route path="*" element={<LibraryPage />} />
      </Routes>
      {/* The reader mounts its own overlay. */}
      {!pathname.startsWith('/read/') && <NightLightOverlay />}
    </>
  );
}
