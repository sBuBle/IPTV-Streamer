import { h } from 'preact';
import { memo } from 'preact/compat';
import { List } from 'react-window';
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

const isSameItem = (item, selectedItem) => !!selectedItem && (
  item === selectedItem ||
  (item.id && selectedItem.id && item.id === selectedItem.id) ||
  (item.code && selectedItem.code && item.code === selectedItem.code)
);

// Row renderer for react-window's List. Defined once so rows aren't remounted on every render.
const Row = ({ index, style, ariaAttributes, items, renderItem, selectedItem }) => {
  const item = items[index];
  if (!item) return null;

  const isSelected = isSameItem(item, selectedItem);

  return (
    <div
      {...ariaAttributes}
      style={style}
      role="option"
      aria-selected={isSelected}
    >
      {renderItem(item, index)}
    </div>
  );
};

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
  onItemsRendered,
  ...otherProps
}) => {
  // Use either class prop version
  const containerClassName = className || classNameAlternative;

  // Return placeholder for empty lists
  if (!items.length) {
    return <div class={containerClassName} style={{ height: `${height}px` }}></div>;
  }

  // Keep the old onItemsRendered({ visibleStartIndex, visibleStopIndex }) callback shape for callers
  const handleRowsRendered = onItemsRendered
    ? ({ startIndex, stopIndex }) => onItemsRendered({ visibleStartIndex: startIndex, visibleStopIndex: stopIndex })
    : undefined;

  return (
    <List
      style={{ height: `${height}px`, width: '100%' }}
      defaultHeight={height}
      rowCount={items.length}
      rowHeight={itemHeight}
      rowComponent={Row}
      rowProps={{ items, renderItem, selectedItem }}
      overscanCount={overscan}
      onRowsRendered={handleRowsRendered}
      className={`virtual-list-container ${containerClassName}`}
      {...otherProps}
    />
  );
});

export default EnhancedVirtualList;
