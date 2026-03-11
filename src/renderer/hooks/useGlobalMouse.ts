import { useEffect, useState } from "react";

interface MouseState {
  x: number;
  y: number;
  isDown: boolean;
}

let subscribers: React.Dispatch<React.SetStateAction<MouseState>>[] = [];
let mouseState: MouseState = { x: 0, y: 0, isDown: false };

function notify() {
  for (const sub of subscribers) {
    sub({ ...mouseState });
  }
}

export function useGlobalMouse(): MouseState {
  const [state, setState] = useState(mouseState);

  useEffect(() => {
    subscribers.push(setState);

    if (subscribers.length === 1) {
      // First subscriber sets up global listeners
      const handleMove = (e: MouseEvent) => {
        mouseState.x = e.clientX;
        mouseState.y = e.clientY;
        notify();
      };
      const handleDown = () => {
        mouseState.isDown = true;
        notify();
      };
      const handleUp = () => {
        mouseState.isDown = false;
        notify();
      };

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mousedown", handleDown);
      window.addEventListener("mouseup", handleUp);

      (window as any).__mouseCleanup = () => {
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mousedown", handleDown);
        window.removeEventListener("mouseup", handleUp);
      };
    }

    return () => {
      subscribers = subscribers.filter((s) => s !== setState);
      if (subscribers.length === 0) {
        (window as any).__mouseCleanup?.();
      }
    };
  }, []);

  return state;
}
