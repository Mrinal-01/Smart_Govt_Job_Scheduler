import { useNavigate } from 'react-router-dom'
import { Compass, Home } from 'lucide-react'
import { Button, Card } from '../components/ui'

export default function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <main className="page">
      <div className="notfound">
        <Card style={{ maxWidth: 460, textAlign: 'center', padding: 32 }}>
          <div className="empty__icon" style={{ margin: '0 auto 12px' }}>
            <Compass size={20} />
          </div>
          <p className="notfound__code">404</p>
          <h1 style={{ fontSize: 19, marginTop: 6, marginBottom: 6 }}>This page doesn’t exist</h1>
          <p className="text-secondary" style={{ fontSize: 12.5, marginBottom: 18, lineHeight: 1.6 }}>
            The link may be out of date. Head back to your dashboard to pick up today’s schedule.
          </p>
          <div className="row" style={{ justifyContent: 'center', gap: 8 }}>
            <Button variant="primary" icon={<Home size={14} />} onClick={() => navigate('/')}>
              Back to dashboard
            </Button>
            <Button variant="secondary" onClick={() => navigate('/sessions')}>
              Study sessions
            </Button>
          </div>
        </Card>
      </div>
    </main>
  )
}
