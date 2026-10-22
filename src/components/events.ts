/** Tiny browser-event bus so the header, the kill-switch dialog and the walkthrough can talk without prop drilling. */
export type TourId = "platform" | "killswitch";

const START_TOUR = "fr:start-tour";
const KILL_SWITCH = "fr:killswitch";

export function startTour(id: TourId) {
  window.dispatchEvent(new CustomEvent(START_TOUR, { detail: { id } }));
}

export function setKillSwitchOpen(open: boolean) {
  window.dispatchEvent(new CustomEvent(KILL_SWITCH, { detail: { open } }));
}

export function onStartTour(handler: (id: TourId) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<{ id: TourId }>).detail.id);
  window.addEventListener(START_TOUR, listener);
  return () => window.removeEventListener(START_TOUR, listener);
}

export function onKillSwitchOpen(handler: (open: boolean) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<{ open: boolean }>).detail.open);
  window.addEventListener(KILL_SWITCH, listener);
  return () => window.removeEventListener(KILL_SWITCH, listener);
}
