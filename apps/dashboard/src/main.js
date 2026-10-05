// SPDX-License-Identifier: GPL-3.0-or-later
import { mount } from 'svelte'
import App from './App.svelte'
import './app.css'
import './dashboard.css'

const app = mount(App, { target: document.getElementById('app') })

export default app
