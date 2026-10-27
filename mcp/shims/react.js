class Component { constructor(p) { this.props = p; } setState() {} }
const R = { Component, createElement: () => null, Fragment: "F", useState: () => [null, () => {}], useEffect: () => {}, useRef: () => ({ current: null }), useMemo: (f) => f(), useCallback: (f) => f };
export default R;
export const { useState, useEffect, useRef, useMemo, useCallback, createElement, Fragment } = R;
export { Component };
