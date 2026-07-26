import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'

// The on-screen keyboard shrinks the visual viewport without changing 100vh, which is
// what makes mobile layouts jump the moment the input takes focus. Tracking the real
// height here means the race screen can stay put.
function trackViewport() {
  const vv = window.visualViewport
  const set = () => document.documentElement.style.setProperty('--vh', `${vv ? vv.height : window.innerHeight}px`)
  set()
  vv?.addEventListener('resize', set)
  vv?.addEventListener('scroll', set)
  window.addEventListener('orientationchange', () => setTimeout(set, 120))
}
trackViewport()

export default mount(App, { target: document.getElementById('app') })
