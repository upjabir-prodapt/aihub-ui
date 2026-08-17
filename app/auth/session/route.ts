import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/server/session/sessionStore';

/**
 * Validates the caller's session.
 * Exposes email, roles, department, and active entitlements to the frontend client.
 */
export async function GET(req: NextRequest) {
  const sessionId = req.cookies.get('__Host-AISESSION')?.value;

  if (!sessionId) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  try {
    const sessionResult = await getSession(sessionId);

    if (!sessionResult) {
      // Session missing or expired
      const errRes = NextResponse.json({ authenticated: false }, { status: 401 });
      errRes.cookies.delete('__Host-AISESSION');
      return errRes;
    }

    const { session } = sessionResult;

    // Check Entra roles for service entitlements
    // translation: Translation.Translate
    // sales: Sales.Research
    const hasTranslation = session.roles.includes('Translation.Translate');
    const hasSales = session.roles.includes('Sales.Research');

    return NextResponse.json({
      authenticated: true,
      email: session.email,
      department: session.department,
      roles: session.roles,
      entitlements: {
        translation: hasTranslation,
        sales: hasSales,
      },
    });
  } catch (err) {
    console.error('Session API validation failedclosed with 503 error:', err);
    // Fail closed with 503 Service Unavailable if downstream DB (Firestore) is down
    return NextResponse.json(
      { error: 'Service temporarily unavailable' },
      { status: 503 }
    );
  }
}
