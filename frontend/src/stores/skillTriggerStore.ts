import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface SkillState {
  id: string
  name: string
  activatedAt: number
  roundsRemaining: number
  triggerCount: number
}

interface SkillTriggerStore {
  activeSkills: Map<string, SkillState>
  triggerHistory: { skillId: string; timestamp: number; round: number }[]

  activateSkill: (skillId: string, skillName: string) => void
  deactivateSkill: (skillId: string) => void
  decayRound: () => void
  getActiveSkillIds: () => string[]
  isSkillActive: (skillId: string) => boolean
  getSkillState: (skillId: string) => SkillState | undefined
  clearAll: () => void
}

const DECAY_ROUNDS = 8

export const useSkillTriggerStore = create<SkillTriggerStore>()(
  persist(
    (set, get) => ({
      activeSkills: new Map(),
      triggerHistory: [],

      activateSkill: (skillId, skillName) => {
        set((s) => {
          const newMap = new Map(s.activeSkills)
          const existing = newMap.get(skillId)
          newMap.set(skillId, {
            id: skillId,
            name: skillName,
            activatedAt: Date.now(),
            roundsRemaining: DECAY_ROUNDS,
            triggerCount: (existing?.triggerCount || 0) + 1,
          })
          return { activeSkills: newMap }
        })
      },

      deactivateSkill: (skillId) => {
        set((s) => {
          const newMap = new Map(s.activeSkills)
          newMap.delete(skillId)
          return { activeSkills: newMap }
        })
      },

      decayRound: () => {
        set((s) => {
          const newMap = new Map<string, SkillState>()
          const newHistory = [...s.triggerHistory]
          for (const [id, skill] of s.activeSkills) {
            const remaining = skill.roundsRemaining - 1
            if (remaining > 0) {
              newMap.set(id, { ...skill, roundsRemaining: remaining })
            } else {
              newHistory.push({ skillId: id, timestamp: Date.now(), round: DECAY_ROUNDS - remaining })
            }
          }
          return { activeSkills: newMap, triggerHistory: newHistory.slice(-100) }
        })
      },

      getActiveSkillIds: () => Array.from(get().activeSkills.keys()),

      isSkillActive: (skillId) => get().activeSkills.has(skillId),

      getSkillState: (skillId) => get().activeSkills.get(skillId),

      clearAll: () => set({ activeSkills: new Map(), triggerHistory: [] }),
    }),
    {
      name: 'novelwriter-skills',
      partialize: (state) => ({
        activeSkills: state.activeSkills,
        triggerHistory: state.triggerHistory,
      }),
    }
  )
)
