import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Float, Sparkles } from '@react-three/drei'
import * as THREE from 'three'
import type { TaskId, TaskStatus } from '../api/types'

type HeroSelection = TaskId | 'bigfiledemo'
type Props = { passed: number; selected: HeroSelection; statuses: Record<string, TaskStatus>; onSelect: (task: TaskId) => void; onRunDemo: () => void }

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <div className="hero-fallback"><div className="fallback-core">xv6</div><span>Four changes. One kernel.</span></div> : this.props.children }
}

const points: [number, number, number][] = [
  [-2.65, 0.92, 0], [2.65, 0.92, 0], [-2.65, -0.92, 0], [2.65, -0.92, 0], [0, -1.95, 0],
]
const taskInfo: { id: HeroSelection; short: string; label: string }[] = [
  { id: 'task1', short: '01', label: 'ALARMS' },
  { id: 'task2a', short: '02A', label: 'LARGE FILES' },
  { id: 'task2b', short: '02B', label: 'SYMLINKS' },
  { id: 'task3', short: '03', label: 'MMAP' },
  { id: 'bigfiledemo', short: 'DEMO', label: '512 BLOCKS' },
]
const colors: Record<string, string> = { pass: '#62e6b7', fail: '#ff6e7e', running: '#7ce6da', idle: '#53616b', error: '#ff6e7e', timeout: '#f1b75c', cancelled: '#77858c' }

function Core({ passed }: { passed: number }) {
  const group = useRef<THREE.Group>(null)
  useFrame((_, delta) => { if (group.current) group.current.rotation.y += delta * 0.09 })
  return (
    <group ref={group}>
      <mesh>
        <icosahedronGeometry args={[0.78, 2]} />
        <meshPhysicalMaterial color="#78eee0" emissive="#14786f" emissiveIntensity={0.36} roughness={0.22} metalness={0.3} wireframe />
      </mesh>
      <mesh>
        <icosahedronGeometry args={[0.44, 1]} />
        <meshBasicMaterial color={passed === 4 ? '#62e6b7' : '#a1fff2'} />
      </mesh>
      <mesh rotation={[Math.PI / 2.9, 0.2, 0]}>
        <torusGeometry args={[1.12, 0.009, 8, 100]} />
        <meshBasicMaterial color="#48c9bd" transparent opacity={0.48} />
      </mesh>
    </group>
  )
}

function OrbitNode({ index, status, selected, onClick }: { index: number; status: TaskStatus; selected: boolean; onClick: () => void }) {
  const ref = useRef<THREE.Group>(null)
  const position = points[index]
  const color = colors[status] || colors.idle
  useFrame(({ clock }) => {
    if (!ref.current) return
    ref.current.position.y = position[1] + Math.sin(clock.elapsedTime * 0.7 + index) * 0.045
    const pulse = status === 'running' ? 1 + Math.sin(clock.elapsedTime * 5) * 0.12 : 1
    ref.current.scale.setScalar(pulse)
  })
  return (
    <group ref={ref} position={position} onClick={onClick}>
      <mesh>
        <sphereGeometry args={[selected ? 0.21 : 0.16, 24, 24]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={status === 'idle' ? 0.2 : 1} roughness={0.3} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.29, 18, 18]} />
        <meshBasicMaterial color={color} transparent opacity={selected ? 0.18 : 0.07} wireframe />
      </mesh>
    </group>
  )
}

function CameraParallax() {
  useFrame(({ pointer, camera }) => {
    camera.position.x += (pointer.x * 0.18 - camera.position.x) * 0.025
    camera.position.y += (pointer.y * 0.12 - camera.position.y) * 0.025
    camera.lookAt(0, 0, 0)
  })
  return null
}

function Scene({ passed, selected, statuses, onSelect, onRunDemo, visible }: Props & { visible: boolean }) {
  const lines = useMemo(() => points.map((point) => new THREE.Vector3(...point)), [])
  return (
    <Canvas frameloop={visible ? 'always' : 'never'} camera={{ position: [0, 0, 8], fov: 37 }} dpr={[1, 1.5]} gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}>
      <CameraParallax />
      <ambientLight intensity={0.7} />
      <pointLight position={[0, 0, 5]} intensity={14} color="#72dcd0" />
      <pointLight position={[-3, 2, 2]} intensity={4} color="#447b90" />
      <Sparkles count={38} scale={[7.2, 3.2, 2]} size={1.1} speed={0.12} opacity={0.25} color="#a4f8ec" />
      <Float speed={0.45} rotationIntensity={0.08} floatIntensity={0.12}>
        <Core passed={passed} />
      </Float>
      {lines.map((point, index) => (
        <group key={index}>
          <LineSegment end={point} color={colors[statuses[taskInfo[index].id] || 'idle']} />
          <OrbitNode index={index} status={statuses[taskInfo[index].id] || 'idle'} selected={selected === taskInfo[index].id} onClick={() => taskInfo[index].id === 'bigfiledemo' ? onRunDemo() : onSelect(taskInfo[index].id)} />
        </group>
      ))}
    </Canvas>
  )
}

function LineSegment({ end, color }: { end: THREE.Vector3; color: string }) {
  const points = useMemo(() => [new THREE.Vector3(0, 0, 0), end], [end])
  return <line>
    <bufferGeometry>
      <bufferAttribute attach="attributes-position" args={[new Float32Array(points.flatMap((point) => point.toArray())), 3]} count={2} itemSize={3} />
    </bufferGeometry>
    <lineBasicMaterial color={color} transparent opacity={0.35} />
  </line>
}

export default function Hero3D(props: Props) {
  const host = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(true)
  const [webgl] = useState(() => {
    try {
      const canvas = document.createElement('canvas')
      return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'))
    } catch { return false }
  })
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting && document.visibilityState === 'visible'), { threshold: 0.05 })
    if (host.current) observer.observe(host.current)
    const updateVisibility = () => setVisible(Boolean(host.current?.getBoundingClientRect().bottom && host.current.getBoundingClientRect().top < window.innerHeight) && document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', updateVisibility)
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', updateVisibility) }
  }, [])
  return <div className="hero-canvas-host" ref={host}>{webgl
    ? <SceneBoundary><Suspense fallback={<div className="hero-fallback"><div className="fallback-core">xv6</div><span>Four changes. One kernel.</span></div>}><Scene {...props} visible={visible} /></Suspense></SceneBoundary>
    : <div className="hero-fallback"><div className="fallback-core">xv6</div><span>Four changes. One kernel.</span></div>}
    {webgl && <div className="scene-overlay" aria-label="Kernel modules"><div className="scene-core-label"><strong>XV6</strong><span>KERNEL CORE</span></div>{taskInfo.map((task, index) => <button key={task.id} className={`orbit-tag orbit-tag-${index} ${props.selected === task.id ? 'is-selected' : ''}`} onClick={() => task.id === 'bigfiledemo' ? props.onRunDemo() : props.onSelect(task.id)} aria-label={task.id === 'bigfiledemo' ? 'Run the 512-block large-file demo' : `Select ${task.label}`}><small>{task.short} · {task.label}{task.id === 'bigfiledemo' ? ' · RUN' : ''}</small></button>)}</div>}
  </div>
}
