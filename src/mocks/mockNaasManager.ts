import type { ServiceOrderTicket } from '../naas/api/types.ts';

// Seed data so NaaSAdmin has something to show without ever calling /chat.
const seedTickets: ServiceOrderTicket[] = [
  {
    id: 1,
    created_at: '2026-08-28T09:14:00Z',
    city: 'London',
    country: 'United Kingdom',
    post_code: 'EC2A 4DP',
    building_id: 'BLD-0192',
    building_name: 'Colt City Point',
    location_id: 'LOC-4471',
    product_id: 'ETH-1G',
    bandwidth: '1 Gbps',
    commitment_period: '24 months',
    rental_charge: '£450/mo',
    status: 'pending',
    approved_at: null,
  },
  {
    id: 2,
    created_at: '2026-08-25T13:02:00Z',
    city: 'Frankfurt',
    country: 'Germany',
    post_code: '60313',
    building_id: 'BLD-0044',
    building_name: 'Colt Datacenter FRA1',
    location_id: 'LOC-2210',
    product_id: 'ETH-10G',
    bandwidth: '10 Gbps',
    commitment_period: '36 months',
    rental_charge: '€1,200/mo',
    status: 'approved',
    approved_at: '2026-08-26T08:45:00Z',
  },
];

class MockNaasManager {
  private tickets: ServiceOrderTicket[] = seedTickets.map((t) => ({ ...t }));
  private nextId = this.tickets.length + 1;

  getPending(): ServiceOrderTicket[] {
    return this.tickets.filter((t) => t.status === 'pending');
  }

  getHistory(): ServiceOrderTicket[] {
    return this.tickets.filter((t) => t.status === 'approved');
  }

  approve(ticketId: number): ServiceOrderTicket | undefined {
    const ticket = this.tickets.find((t) => t.id === ticketId);
    if (!ticket) return undefined;
    ticket.status = 'approved';
    ticket.approved_at = new Date().toISOString();
    return ticket;
  }

  createTicket(partial: Partial<ServiceOrderTicket>): ServiceOrderTicket {
    const ticket: ServiceOrderTicket = {
      id: this.nextId++,
      created_at: new Date().toISOString(),
      city: null,
      country: null,
      post_code: null,
      building_id: null,
      building_name: null,
      location_id: null,
      product_id: null,
      bandwidth: null,
      commitment_period: null,
      rental_charge: null,
      status: 'pending',
      approved_at: null,
      ...partial,
    };
    this.tickets.push(ticket);
    return ticket;
  }
}

export const mockNaasManager = new MockNaasManager();
