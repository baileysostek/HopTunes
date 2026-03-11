import { useEffect, useState, useRef } from 'react';

/**
 * Custom hook to check if a DOM element has a child of a specific type and return it.
 *
 * @param parentRef A React ref to the parent container element.
 * @param childType A string identifier for the child component (e.g., 'data-child-type="my-component"').
 * @returns A tuple containing a boolean and the child HTMLElement or null if not found.
 */
export const useHasChildOfType = (
  parentRef: React.RefObject<HTMLElement | null>,
  childType: string
): [boolean, HTMLElement | null] => {
  const [childElement, setChildElement] = useState<HTMLElement | null>(null);
  const childSelector = `[data-child-type="${childType}"]`;

  useEffect(() => {
    const parentElement = parentRef.current;
    if (!parentElement) return;

    const observer = new MutationObserver(() => {
      // Find the card element and update state.
      const foundChild = parentElement.querySelector<HTMLElement>(childSelector);
      setChildElement(foundChild);
    });

    observer.observe(parentElement, { childList: true, subtree: false });

    // Initial check when the component mounts.
    const initialChild = parentElement.querySelector<HTMLElement>(childSelector);
    setChildElement(initialChild);

    return () => {
      observer.disconnect();
    };
  }, [parentRef, childSelector]);

  // The boolean is derived from the presence of the childElement.
  const hasChild = !!childElement;
  return [hasChild, childElement];
};