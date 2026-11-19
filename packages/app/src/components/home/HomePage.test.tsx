import { screen } from '@testing-library/react';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { searchApiRef } from '@backstage/plugin-search-react';
import { HomePage, TOOLS } from './HomePage';

jest.mock('@backstage-community/plugin-announcements', () => ({
  AnnouncementsCard: ({ title }: { title: string }) => <div>{title}</div>,
  NewAnnouncementBanner: () => null,
}));
jest.mock('@backstage/plugin-home', () => ({
  ...jest.requireActual('@backstage/plugin-home'),
  HomePageStarredEntities: () => <div>Starred</div>,
  HomePageRecentlyVisited: () => <div>Recently</div>,
  HomePageTopVisited: () => <div>Top</div>,
}));
jest.mock('@backstage/plugin-search', () => ({
  HomePageSearchBar: () => <input aria-label="search" />,
}));

describe('HomePage', () => {
  it('renders the toolkit and the news card', async () => {
    await renderInTestApp(
      <TestApiProvider
        apis={[
          [
            searchApiRef,
            { query: jest.fn().mockResolvedValue({ results: [] }) },
          ],
        ]}
      >
        <HomePage />
      </TestApiProvider>,
    );
    for (const tool of TOOLS) {
      expect(screen.getByText(tool.label)).toBeInTheDocument();
    }
    expect(screen.getByText('Platform news')).toBeInTheDocument();
    expect(screen.getByText('Platform')).toBeInTheDocument();
  });
});
