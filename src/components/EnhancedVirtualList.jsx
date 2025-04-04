import { h } from 'preact';
import { memo } from 'preact/compat';
import { FixedSizeList as ReactWindowList } from 'react-window';
import { options } from 'preact';

// Set up Preact compatibility for React components
if (typeof options.vnode === 'function') {
  const originalVNode = options.vnode;
  options.vnode = (vnode) => {
    // Transform className to class for Preact
    if (vnode.props && vnode.props.className && !vnode.props.class) {
      vnode.props.class = vnode.props.className;
      delete vnode.props.className;
    }
    
    // Run any existing vnode hooks
    if (originalVNode) originalVNode(vnode);
  };
}

/**
 * Enhanced virtual list implementation using react-window with Preact
 */
export const EnhancedVirtualList = memo(({
  items = [],
  renderItem,
  height = 400,
  itemHeight = 40,
  overscan = 3,
  selectedItem,
  class: className = '',
  className: classNameAlternative = '',
  ...otherProps
}) => {
  // Use either class prop version
  const containerClassName = className || classNameAlternative;
  
  // Return placeholder for empty lists
  if (!items.length) {
    return <div class={containerClassName} style={{ height: `${height}px` }}></div>;
  }
  
  // Item renderer function for react-window
  const itemRenderer = ({ index, style }) => {
    const item = items[index];
    if (!item) return null;
    
    // Determine if item is selected
    const isSelected = selectedItem && (
      (item === selectedItem) ||
      (item.id && selectedItem.id && item.id === selectedItem.id) ||
      (item.code && selectedItem.code && item.code === selectedItem.code)
    );
    
    // Apply selection classes
    const itemClassName = isSelected ? 'bg-blue-700 text-white' : '';
    
    return (
      <div 
        style={style} 
        class={itemClassName}
        role="option"
        aria-selected={isSelected}
      >
        {renderItem(item, index)}
      </div>
    );
  };
  
  return (
    <ReactWindowList
      height={height}
      width="100%"
      itemCount={items.length}
      itemSize={itemHeight}
      overscanCount={overscan}
      className={`virtual-list-container ${containerClassName}`}
      {...otherProps}
    >
      {itemRenderer}
    </ReactWindowList>
  );
});

export default EnhancedVirtualList;
