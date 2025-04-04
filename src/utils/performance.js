/**
 * Performance utilities for optimizing UI operations
 * These are now just re-exports from lodash-es for better performance
 */
import { debounce as _debounce, throttle as _throttle } from 'lodash-es';

// Re-export with same interface for backwards compatibility
export const debounce = _debounce;
export const throttle = _throttle;

// Cache function results with memoize-one for complex calculations
export { default as memoize } from 'memoize-one';
