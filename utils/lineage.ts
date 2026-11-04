import type { Person, Relationship } from '@/types'

type Edge = Pick<Relationship, 'person_a' | 'person_b' | 'type'> & {
  family_branch_id?: string | null
}

// Each branch has its own ancestry; a person may participate in several scopes.
export function hasAncestryCycle(relationships: readonly Edge[]): boolean {
  const scopes = new Map<string, Edge[]>()
  for (const edge of relationships) {
    if (!['biological_child', 'adopted_child'].includes(edge.type)) continue
    const scope = edge.family_branch_id || ''
    if (!scopes.has(scope)) scopes.set(scope, [])
    scopes.get(scope)!.push(edge)
  }
  for (const edges of scopes.values()) {
    const children = new Map<string, string[]>()
    const degree = new Map<string, number>()
    for (const edge of edges) {
      if (!children.has(edge.person_a)) children.set(edge.person_a, [])
      children.get(edge.person_a)!.push(edge.person_b)
      if (!degree.has(edge.person_a)) degree.set(edge.person_a, 0)
      degree.set(edge.person_b, (degree.get(edge.person_b) || 0) + 1)
    }
    const queue = [...degree]
      .filter(([, count]) => count === 0)
      .map(([id]) => id)
    for (let i = 0; i < queue.length; i++) {
      for (const child of children.get(queue[i]) || []) {
        degree.set(child, degree.get(child)! - 1)
        if (degree.get(child) === 0) queue.push(child)
      }
    }
    if (queue.length !== degree.size) return true
  }
  return false
}

export function computeGenerations(
  persons: Person[],
  relationships: Relationship[]
): Map<string, number> {
  if (hasAncestryCycle(relationships)) throw new Error('ancestry_cycle')

  // Marriage requires equal generations. Collapse spouses before checking for
  // positive ancestry loops, including components no root can reach.
  const groups = new Map(persons.map((person) => [person.id, person.id]))
  const group = (id: string): string => {
    let root = id
    while (groups.has(root) && groups.get(root) !== root)
      root = groups.get(root)!
    while (groups.has(id) && groups.get(id) !== id) {
      const next = groups.get(id)!
      groups.set(id, root)
      id = next
    }
    return root
  }
  for (const edge of relationships) {
    if (edge.type === 'marriage')
      groups.set(group(edge.person_a), group(edge.person_b))
  }
  const generationEdges: Edge[] = []
  for (const edge of relationships) {
    if (edge.type !== 'biological_child' && edge.type !== 'adopted_child')
      continue
    generationEdges.push({
      ...edge,
      person_a: group(edge.person_a),
      person_b: group(edge.person_b)
    })
  }
  if (hasAncestryCycle(generationEdges)) throw new Error('ancestry_cycle')

  // Build child→parents map (only biological/adopted relationships)
  const childParents = new Map<string, string[]>()
  // Build parent→children map
  const parentChildren = new Map<string, string[]>()

  for (const r of relationships) {
    if (r.type === 'biological_child' || r.type === 'adopted_child') {
      // person_a = parent, person_b = child
      if (!childParents.has(r.person_b)) childParents.set(r.person_b, [])
      childParents.get(r.person_b)!.push(r.person_a)

      if (!parentChildren.has(r.person_a)) parentChildren.set(r.person_a, [])
      parentChildren.get(r.person_a)!.push(r.person_b)
    }
  }

  // Build marriage map: person → spouses
  const spouseMap = new Map<string, string[]>()
  for (const r of relationships) {
    if (r.type === 'marriage') {
      if (!spouseMap.has(r.person_a)) spouseMap.set(r.person_a, [])
      spouseMap.get(r.person_a)!.push(r.person_b)
      if (!spouseMap.has(r.person_b)) spouseMap.set(r.person_b, [])
      spouseMap.get(r.person_b)!.push(r.person_a)
    }
  }

  // Roots = persons who have NO parents AND NO spouses
  // (If they have a spouse, we'll try to get their generation from the spouse later or vice versa)
  const trueRoots = persons.filter(
    (p) => !childParents.has(p.id) && !spouseMap.has(p.id)
  )

  // Also include persons who have spouses, but neither they nor any of their spouses have parents
  // (to jumpstart disconnected families)
  const processedRoots = new Set(trueRoots.map((p) => p.id))
  for (const p of persons.filter(
    (p) => !childParents.has(p.id) && spouseMap.has(p.id)
  )) {
    const spouses = spouseMap.get(p.id) || []
    const anySpouseHasParents = spouses.some((sId) => childParents.has(sId))
    if (
      !anySpouseHasParents &&
      !processedRoots.has(p.id) &&
      !spouses.some((sId) => processedRoots.has(sId))
    ) {
      // If neither this person nor their spouse has parents, pick one as a root
      trueRoots.push(p)
      processedRoots.add(p.id)
    }
  }

  const genMap = new Map<string, number>()

  // BFS from roots
  const queue: Array<{ id: string; gen: number }> = trueRoots.map((r) => ({
    id: r.id,
    gen: 1
  }))

  while (queue.length > 0) {
    const { id, gen } = queue.shift()!

    // Use the longest path (deepest generation)
    // If we've already found a path that makes this person an equal or deeper generation, stop
    if (genMap.has(id) && gen <= genMap.get(id)!) {
      continue
    }

    if (gen > persons.length) throw new Error('ancestry_cycle')
    genMap.set(id, gen)

    // Propagate to children
    const children = parentChildren.get(id) || []
    for (const childId of children) {
      queue.push({ id: childId, gen: gen + 1 })
    }

    // Propagate to spouses to ensure they process their children too,
    // and they get an equal generation.
    const spouses = spouseMap.get(id) || []
    for (const spouseId of spouses) {
      // We don't want to endlessly loop between spouses, so only push if spouse has a smaller/no generation
      if (!genMap.has(spouseId) || gen > genMap.get(spouseId)!) {
        queue.push({ id: spouseId, gen: gen })
      }
    }
  }

  // Fallback for anyone missed (e.g. disconnected loops)
  // Assign generation to spouses based on their partner's generation
  let changed = true
  while (changed) {
    changed = false
    for (const p of persons) {
      if (genMap.has(p.id)) continue
      const spouses = spouseMap.get(p.id) || []
      for (const spouseId of spouses) {
        if (genMap.has(spouseId)) {
          genMap.set(p.id, genMap.get(spouseId)!)
          changed = true
          break
        }
      }
    }
  }

  // Persons not reachable from any root (orphaned or disconnected in-laws)
  // leave generation as null -- we don't assign them
  return genMap
}
