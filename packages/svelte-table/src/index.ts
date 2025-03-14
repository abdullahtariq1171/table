import {
  createTableFactory,
  createTableInstance as coreCreateTableInstance,
  PartialKeys,
  Table,
  TableGenerics,
  TableOptions,
  TableOptionsResolved,
} from '@tanstack/table-core'
import Placeholder from './placeholder'
import { SvelteComponent } from 'svelte/internal'
import { readable, writable, derived, Readable, get } from 'svelte/store'
import { renderComponent } from './render-component'

export { renderComponent } from './render-component'

export * from '@tanstack/table-core'

function isSvelteServerComponent(component: any) {
  return (
    typeof component === 'object' &&
    typeof component.$$render === 'function' &&
    typeof component.render === 'function'
  )
}

function isSvelteClientComponent(component: any) {
  let isHMR = '__SVELTE_HMR' in window

  return (
    component.prototype instanceof SvelteComponent ||
    (isHMR &&
      component.name?.startsWith('Proxy<') &&
      component.name?.endsWith('>'))
  )
}

function isSvelteComponent(component: any) {
  if (typeof document === 'undefined') {
    return isSvelteServerComponent(component)
  } else {
    return isSvelteClientComponent(component)
  }
}

function wrapInPlaceholder(content: any) {
  return renderComponent(Placeholder, { content })
}

export function render(component: any, props: any) {
  if (!component) return null

  if (isSvelteComponent(component)) {
    return renderComponent(component, props)
  }

  if (typeof component === 'function') {
    const result = component(props)

    if (isSvelteComponent(result)) {
      return result
    }

    return wrapInPlaceholder(result)
  }

  return wrapInPlaceholder(component)
}

export const createTable = createTableFactory({ render })

type ReadableOrVal<T> = T | Readable<T>

export function createTableInstance<TGenerics extends TableGenerics>(
  table: Table<TGenerics>,
  options: ReadableOrVal<TableOptions<TGenerics>>
) {
  let optionsStore: Readable<TableOptions<TGenerics>>

  if ('subscribe' in options) {
    optionsStore = options
  } else {
    optionsStore = readable(options)
  }

  let resolvedOptions: TableOptionsResolved<TGenerics> = {
    ...table.options,
    state: {}, // Dummy state
    onStateChange: () => {}, // noop
    render,
    renderFallbackValue: null,
    ...get(optionsStore),
  }

  let instance = coreCreateTableInstance(resolvedOptions)

  let stateStore = writable(/** @type {number} */ instance.initialState)
  // combine stores
  let stateOptionsStore = derived([stateStore, optionsStore], s => s)
  const instanceReadable = readable(instance, function start(set) {
    const unsubscribe = stateOptionsStore.subscribe(([state, options]) => {
      instance.setOptions(prev => {
        return {
          ...prev,
          ...options,
          state: { ...state, ...options.state },
          // Similarly, we'll maintain both our internal state and any user-provided
          // state.
          onStateChange: updater => {
            if (updater instanceof Function) {
              stateStore.update(updater)
            } else {
              stateStore.set(updater)
            }

            resolvedOptions.onStateChange?.(updater)
          },
        }
      })

      // it didn't seem to rerender without setting the instance
      set(instance)
    })

    return function stop() {
      unsubscribe()
    }
  })

  return instanceReadable
}
