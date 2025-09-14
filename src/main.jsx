import React from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import App from './App.jsx';
import Landing from './features/landing/Landing.jsx';
import Metadata from './features/metadata/Metadata.jsx';
import Planner from './features/planner/Planner.jsx';
import QnA from './features/qa/QnA.jsx';
import Figures from './features/figures/Figures.jsx';
import References from './features/references/References.jsx';
import Declarations from './features/declarations/Declarations.jsx';
import { ProjectProvider } from './app/state.jsx';
import Preview from './features/preview/Preview.jsx';

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Landing /> },
      { path: 'metadata', element: <Metadata /> },
      { path: 'planner', element: <Planner /> },
      { path: 'qa/:sectionId?', element: <QnA /> },
      { path: 'figures', element: <Figures /> },
      { path: 'references', element: <References /> },
      { path: 'declarations', element: <Declarations /> },
      { path: 'preview', element: <Preview /> }
    ]
  }
]);

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
        <ProjectProvider>
      <RouterProvider router={router} />
    </ProjectProvider>
  </React.StrictMode>
);
