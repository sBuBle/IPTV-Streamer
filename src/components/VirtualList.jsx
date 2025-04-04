import { h } from 'preact';
import { useState, useRef, useEffect, useCallback } from 'preact/hooks';
import { throttle } from '../utils/performance';

/**
 * A virtualized list component that only renders visible items
 * @param {Object} props Component props
 * @param {Array} props.items Array of items to render
 * @param {Function} props.renderItem Function to render each item
 * @param {number} props.height Height of the list container
 * @param {number} props.itemHeight Height of each item
 * @param {number} props.overscan Number of items to render outside of view (default: 3)
 * @param {boolean} props.keyboardNavigation Enable keyboard navigation (default: false)
 * @param {Function} props.keyboardNavSelectionCallback Callback when item is selected with keyboard
 * @param {Object} props.selectedItem The currently selected item
 * @param {string} props.class CSS class for the container (Preact uses class instead of className)
 */
export function VirtualList({ 
  items = [], 
  renderItem, 
  height = 400, 
  itemHeight = 40,
  overscan = 3,
  keyboardNavigation = false,
  keyboardNavSelectionCallback,
  selectedItem,
  class: className = '', // Accept 'class' prop but use as className internally
  className: classNameAlternative = '', // Also accept className for flexibility
  ...otherProps
}) {
  // Use either prop version
  const containerClassName = className || classNameAlternative;

  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef(null);
  const [containerHeight, setContainerHeight] = useState(height);
  const [keyboardFocusIndex, setKeyboardFocusIndex] = useState(-1);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimerRef = useRef(null);

  // Use effect to ensure the height is correct
  useEffect(() => {
    if (height > 0) {
      setContainerHeight(height);
    }
  }, [height]);

  // Calculate which items should be rendered
  const totalHeight = Math.max(1, items.length * itemHeight);
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const visibleCount = Math.ceil(containerHeight / itemHeight) + 2 * overscan;
  const endIndex = Math.min(
    items.length - 1,
    startIndex + visibleCount
  );

  // Properly throttled scroll handler with dependencies
  const handleScroll = useCallback(
    throttle((e) => {
      const scrollTop = e.currentTarget.scrollTop;
      setScrollTop(scrollTop);
      
      // Indicate scrolling for optimizations
      setIsScrolling(true);
      
      // Clear previous timer
      if (scrollTimerRef.current) {
        clearTimeout(scrollTimerRef.current);
      }
      
      // Set scrolling state back to false after scrolling stops
      scrollTimerRef.current = setTimeout(() => {
        setIsScrolling(false);
      }, 150);
    }, 16), // ~60fps
    []
  );
  
  // Initialize scroll position if container ref changes
  useEffect(() => {
    if (containerRef.current) {
      setScrollTop(containerRef.current.scrollTop);
    }
    
    // Cleanup scroll timer
    return () => {
      if (scrollTimerRef.current) {
        clearTimeout(scrollTimerRef.current);
      }
    };
  }, []);
  
  // Scroll to focused item when using keyboard navigation
  useEffect(() => {
    if (!keyboardNavigation || keyboardFocusIndex < 0 || !containerRef.current) {
      return;
    }
    
    const itemTop = keyboardFocusIndex * itemHeight;
    const itemBottom = itemTop + itemHeight;
    
    const viewportTop = containerRef.current.scrollTop;
    const viewportBottom = viewportTop + containerHeight;
    
    // If item is outside of viewport, scroll to it
    if (itemTop < viewportTop) {
      containerRef.current.scrollTop = itemTop;
    } else if (itemBottom > viewportBottom) {
      containerRef.current.scrollTop = itemBottom - containerHeight;
    }
  }, [keyboardFocusIndex, keyboardNavigation, itemHeight, containerHeight]);
  
  // Handle keyboard navigation
  const handleKeyDown = useCallback((e) => {
    if (!keyboardNavigation || !items.length) {
      return;
    }
    
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setKeyboardFocusIndex(prev => {
          const next = Math.min(items.length - 1, prev + 1);
          return next;
        });
        break;
      
      case 'ArrowUp':
        e.preventDefault();
        setKeyboardFocusIndex(prev => {
          const next = Math.max(0, prev - 1);
          return next;
        });
        break;
      
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (keyboardFocusIndex >= 0 && keyboardFocusIndex < items.length && keyboardNavSelectionCallback) {
          keyboardNavSelectionCallback(items[keyboardFocusIndex]);
        }
        break;
        
      case 'Home':
        e.preventDefault();
        setKeyboardFocusIndex(0);
        break;
        
      case 'End':
        e.preventDefault();
        setKeyboardFocusIndex(items.length - 1);
        break;
        
      default:
        break;
    }
  }, [keyboardNavigation, items, keyboardNavSelectionCallback]);

  // If there are no items, return an empty container with proper height
  if (!items.length) {
    return <div className={containerClassName} style={{ height: `${containerHeight}px` }}></div>;
  }

  // Only build visible items to improve performance
  const visibleItems = [];
  for (let i = startIndex; i <= endIndex && i < items.length; i++) {
    if (items[i]) {
      visibleItems.push({
        index: i,
        item: items[i],
        offsetY: i * itemHeight
      });
    }
  }

  // More efficient item selection logic
  const isItemSelected = useCallback((item) => {
    if (!selectedItem || !item) return false;
    
    // For simple values, direct equality
    if (typeof item !== 'object' || typeof selectedItem !== 'object') {
      return item === selectedItem;
    }
    
    // For objects, check common ID fields
    return (
      (item.id && selectedItem.id && item.id === selectedItem.id) || 
      (item.code && selectedItem.code && item.code === selectedItem.code)
    );
  }, [selectedItem]);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      onKeyDown={handleKeyDown}
      class={`virtual-list-container ${containerClassName}`} // Use 'class' in Preact
      style={{ 
        height: `${containerHeight}px`, 
        overflowY: 'auto',
        overflowX: 'hidden',
        position: 'relative',
        willChange: isScrolling ? 'transform' : 'auto' // Only set willChange during scrolling
      }}
      tabIndex={keyboardNavigation ? 0 : undefined}
      role="listbox"
      aria-activedescendant={keyboardFocusIndex >= 0 ? `virtual-item-${keyboardFocusIndex}` : undefined}
      {...otherProps}
    >
      <div 
        style={{ 
          height: `${totalHeight}px`, 
          position: 'relative'
        }}
      >
        {visibleItems.map(({ item, index, offsetY }) => (
          <div
            key={`virtual-item-${index}`}
            id={`virtual-item-${index}`}
            className={`${index === keyboardFocusIndex || isItemSelected(item) ? 'virtual-item-focused' : ''} ${
              isItemSelected(item) ? 'bg-blue-700 text-white' : ''
            }`}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              transform: `translateY(${offsetY}px)`,
              width: '100%'
            }}
            role="option"
            aria-selected={index === keyboardFocusIndex || isItemSelected(item)}
          >
            {item ? renderItem(item, index) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export default VirtualList;
