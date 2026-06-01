import { create } from 'zustand'

export interface PlanStep {
  id: string
  label: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  note?: string
}

interface PlanStore {
  currentPlan: any | null
  steps: PlanStep[]
  setPlan: (plan: any) => void
  updateStepStatus: (id: string, status: PlanStep['status']) => void
  addNote: (id: string, note: string) => void
  clearPlan: () => void
}

export const usePlanStore = create<PlanStore>((set) => ({
  currentPlan: null,
  steps: [],
  setPlan: (plan) => {
    const steps: PlanStep[] = []
    if (plan?.context_sources) {
      plan.context_sources.forEach((src: string, i: number) => {
        steps.push({ id: `ctx-${i}`, label: `加载: ${src}`, status: 'completed' })
      })
    }
    if (plan?.active_skills) {
      plan.active_skills.forEach((skill: any, i: number) => {
        steps.push({ id: `skill-${i}`, label: `技能: ${skill.display_name || skill.id}`, status: 'completed' })
      })
    }
    steps.push({ id: 'execute', label: '执行工作流', status: 'in_progress' })
    set({ currentPlan: plan, steps })
  },
  updateStepStatus: (id, status) => set((state) => ({
    steps: state.steps.map(s => s.id === id ? { ...s, status } : s),
  })),
  addNote: (id, note) => set((state) => ({
    steps: state.steps.map(s => s.id === id ? { ...s, note } : s),
  })),
  clearPlan: () => set({ currentPlan: null, steps: [] }),
}))
