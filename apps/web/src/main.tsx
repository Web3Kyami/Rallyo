import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'

import { router } from './app/router'
import { SessionProvider } from './app/session'
import './styles/app.css'
import './styles/base.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('Rallyo web root is missing.')
}

createRoot(root).render(
  <SessionProvider>
    <RouterProvider router={router} />
  </SessionProvider>,
)
