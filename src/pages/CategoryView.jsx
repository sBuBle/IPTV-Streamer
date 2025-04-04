import { h } from "preact";
import { useState, useEffect, useRef, useCallback } from "preact/hooks";
import { route } from "preact-router"; // Remove wouter import
import {
  Loader,
  Search,
  Filter,
  Grid,
  List as ListIcon,
  AlertCircle,
  Tag,
} from "lucide-preact";
import { getCategories, getAllChannels } from "../utils/playlist";
import { getChannelColor, getChannelInitials } from "../utils/logoService";
import { get, set, has } from '../utils/idbStorage';
import * as apiClient from "../utils/apiClient";

// Convert from wouter's useRoute to preact-router's props pattern
export default function CategoryView(props) {
  // Instead of useRoute, extract id from props
  const categoryId = props.id;
  
  const isMounted = useRef(true);
  const abortControllerRef = useRef(null);

  const [category, setCategory] = useState(null);
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isGridView, setIsGridView] = useState(true);
  const [groups, setGroups] = useState([]);
  const [filterGroup, setFilterGroup] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [error, setError] = useState(null);
  const [loadAttempted, setLoadAttempted] = useState(false);
  const [page, setPage] = useState(1);
  const [channelsPerPage] = useState(40);
  const [retryCount, setRetryCount] = useState(0);
  const MAX_RETRIES = 3;

  useEffect(() => {
    return () => {
      isMounted.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  useEffect(() => {
    if (categoryId) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();
      
      setLoading(true);
      setLoadAttempted(false);
      setError(null);
      setRetryCount(0);
      setPage(1);
      setSearchQuery("");
      setFilterGroup("");
      loadCategory();
    }
  }, [categoryId]);

  async function loadCategory() {
    if (loadAttempted) return;
    setLoadAttempted(true);

    try {
      const cacheKey = `category_${categoryId}_data`;
      const cachedData = await get(cacheKey);
      
      if (cachedData && cachedData.timestamp && (Date.now() - cachedData.timestamp < 30 * 60 * 1000)) {
        setCategory(cachedData.category);
        setChannels(cachedData.channels);
        setGroups(cachedData.groups);
        setLoading(false);
        return;
      }

      const categories = await getCategories();
      const currentCategory = categories.find(
        (c) => c.id?.toLowerCase() === categoryId?.toLowerCase()
      );

      const categoryObj = currentCategory || {
        id: categoryId || "unknown",
        name: categoryId
          ? categoryId.charAt(0).toUpperCase() + categoryId.slice(1)
          : "Unknown"
      };
      
      setCategory(categoryObj);

      await loadChannels(categoryId, categoryObj);
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log('Category loading aborted');
        return;
      }
      
      console.error(`Error loading category ${categoryId}:`, err);
      setError(`Failed to load category: ${err.message}`);
      setLoading(false);
      setLoadAttempted(true);
    }
  }

  async function loadChannels(categoryId, categoryObj) {
    try {
      const signal = abortControllerRef.current?.signal;
      
      if (retryCount >= MAX_RETRIES) {
        setError(`Failed to load channels after ${MAX_RETRIES} attempts.`);
        setLoading(false);
        return;
      }

      let apiChannelsLoaded = false;
      let categoryChannels = [];
      let uniqueGroups = [];

      try {
        const apiPromise = new Promise(async (resolve, reject) => {
          try {
            const channels = await apiClient.getChannels({
              category: categoryId.toLowerCase(),
              signal
            });
            resolve(channels);
          } catch (err) {
            reject(err);
          }
        });

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("API call timed out")), 5000)
        );

        categoryChannels = await Promise.race([
          apiPromise,
          timeoutPromise,
        ]);

        if (categoryChannels && categoryChannels.length > 0) {
          const enhancedChannels = categoryChannels.map((channel) => ({
            ...channel,
            logo: channel.logo || apiClient.getLogoUrl(channel.name),
            categories: channel.categories || [
              { id: categoryId, name: categoryObj?.name || categoryId },
            ],
          }));

          categoryChannels = enhancedChannels;

          uniqueGroups = [
            ...new Set(
              enhancedChannels.map(
                (item) =>
                  item.group || (item.countries && item.countries[0]?.name)
              )
            ),
          ]
            .filter(Boolean)
            .sort();
          
          apiChannelsLoaded = true;
        }
      } catch (apiErr) {
        if (apiErr.name === 'AbortError') {
          console.log('Category API request aborted');
          return;
        }
        console.warn("Failed to get category channels from API:", apiErr);
      }

      if (!apiChannelsLoaded) {
        const allChannels = await getAllChannels();

        if (!allChannels) {
          throw new Error("Failed to load channels");
        }

        const categoryIdLower = categoryId.toLowerCase();

        categoryChannels = allChannels.filter((channel) => {
          if (
            channel.category &&
            typeof channel.category === "string" &&
            channel.category.toLowerCase().includes(categoryIdLower)
          ) {
            return true;
          }

          if (
            Array.isArray(channel.categories) &&
            channel.categories.length > 0
          ) {
            return channel.categories.some((cat) => {
              if (typeof cat === "string") {
                return cat.toLowerCase().includes(categoryIdLower);
              } else if (typeof cat === "object") {
                return (
                  (cat.id && cat.id.toLowerCase().includes(categoryIdLower)) ||
                  (cat.name && cat.name.toLowerCase().includes(categoryIdLower))
                );
              }
              return false;
            });
          }

          // Check channel name as a last resort for certain categories
          if (
            ["news", "sports", "music", "movie", "kids"].includes(
              categoryIdLower
            )
          ) {
            const nameLower = (channel.name || "").toLowerCase();
            return nameLower.includes(categoryIdLower);
          }

          return false;
        });

        // Extract unique groups
        uniqueGroups = [
          ...new Set(categoryChannels.map((item) => item.group)),
        ]
          .filter(Boolean)
          .sort();
      }
      
      // Only update state if component is still mounted
      if (isMounted.current) {
        setChannels(categoryChannels);
        setGroups(uniqueGroups);
        
        try {
          // Cache the results
          await set(`category_${categoryId}_data`, {
            category: categoryObj,
            channels: categoryChannels,
            groups: uniqueGroups,
            timestamp: Date.now()
          });
        } catch (cacheErr) {
          console.error("Error caching category data:", cacheErr);
        }
        
        setLoading(false);
        
        if (categoryChannels.length === 0) {
          setError(`No channels found for category "${categoryId}"`);
        }
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('Category channels request aborted');
        return;
      }
      
      console.error("Failed to load category channels:", error);
      
      if (isMounted.current) {
        setError(`Failed to load channels: ${error.message}`);
        setRetryCount(prev => prev + 1);
        setLoading(false);
      }
    } 
  }

  // Filter channels based on search query and group filter
  const filteredChannels = channels.filter((channel) => {
    const matchesSearch = (channel.name || "")
      .toLowerCase()
      .includes(searchQuery.toLowerCase());
    const matchesGroup = filterGroup ? channel.group === filterGroup : true;
    return matchesSearch && matchesGroup;
  });

  // Sort channels based on selected sort option
  const sortedChannels = [...filteredChannels].sort((a, b) => {
    if (sortBy === "name") {
      return (a.name || "").localeCompare(b.name || "");
    } else if (sortBy === "group") {
      return (a.group || "Uncategorized").localeCompare(
        b.group || "Uncategorized"
      );
    }
    return 0;
  });

  // Calculate pagination
  const totalPages = Math.ceil(sortedChannels.length / channelsPerPage);
  const paginatedChannels = sortedChannels.slice(
    (page - 1) * channelsPerPage,
    page * channelsPerPage
  );

  // Add pagination controls at the bottom of the component before the return statement
  const renderPaginationControls = () => {
    if (totalPages <= 1) return null;

    return (
      <div class="flex justify-center my-6">
        <div class="flex items-center gap-1">
          <button
            onClick={() => setPage(1)}
            disabled={page === 1}
            class="px-3 py-2 bg-gray-700 rounded-lg disabled:opacity-50"
          >
            First
          </button>

          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            class="px-3 py-2 bg-gray-700 rounded-lg disabled:opacity-50"
          >
            Prev
          </button>

          <span class="px-3 py-2">
            Page {page} of {totalPages}
          </span>

          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            class="px-3 py-2 bg-gray-700 rounded-lg disabled:opacity-50"
          >
            Next
          </button>

          <button
            onClick={() => setPage(totalPages)}
            disabled={page === totalPages}
            class="px-3 py-2 bg-gray-700 rounded-lg disabled:opacity-50"
          >
            Last
          </button>
        </div>
      </div>
    );
  };

  // Reset retry count when category changes
  useEffect(() => {
    if (categoryId) {
      setRetryCount(0);
    }
  }, [categoryId]);

  return (
    <div>
      {/* Header section */}
      <div class="mb-6">
        <h2 class="text-3xl font-bold mb-2 flex items-center gap-3">
          <Tag class="text-blue-500" />
          {category?.name ||
            (categoryId
              ? categoryId.charAt(0).toUpperCase() + categoryId.slice(1)
              : "Unknown Category")}
        </h2>
        <p class="text-gray-400">
          {category?.description ||
            `Channels in the ${
              category?.name ||
              (categoryId
                ? categoryId.charAt(0).toUpperCase() + categoryId.slice(1)
                : "unknown")
            } category`}
        </p>
      </div>

      {/* Search and filters */}
      <div class="mb-6 bg-gray-800 p-4 rounded-lg">
        <div class="flex flex-col md:flex-row gap-4">
          <div class="relative flex-1">
            <input
              type="text"
              placeholder={`Search ${category?.name || "all"} channels...`}
              class="w-full px-4 py-2 pl-10 bg-gray-700 rounded-lg border border-gray-600"
              value={searchQuery}
              onInput={(e) => setSearchQuery(e.target.value)}
            />
            <Search class="absolute left-3 top-2.5 w-5 h-5 text-gray-400" />
          </div>

          <div class="flex flex-wrap gap-2">
            {groups.length > 0 && (
              <div class="relative">
                <select
                  aria-label="Filter by group"
                  class={`px-4 py-2 pr-8 bg-gray-700 rounded-lg border ${
                    filterGroup ? "border-blue-500" : "border-gray-600"
                  } appearance-none`}
                  value={filterGroup}
                  onChange={(e) => setFilterGroup(e.target.value)}
                >
                  <option value="">All Groups</option>
                  {groups.map((group) => (
                    <option key={group} value={group}>
                      {group || "Uncategorized"}
                    </option>
                  ))}
                </select>
                <Filter class="absolute right-2 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
            )}

            <div class="relative">
              <select
                aria-label="Sort channels"
                class="px-4 py-2 pr-8 bg-gray-700 rounded-lg border border-gray-600 appearance-none"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                <option value="name">Sort by Name</option>
                <option value="group">Sort by Group</option>
              </select>
              <div class="absolute right-2 top-2.5 w-4 h-4 text-gray-400 pointer-events-none">
                {sortBy === "name" ? "↓A" : "↓#"}
              </div>
            </div>

            <button
              onClick={() => setIsGridView(!isGridView)}
              class="px-3 py-2 bg-gray-700 rounded-lg border border-gray-600 flex items-center gap-2"
              title={isGridView ? "Switch to list view" : "Switch to grid view"}
              aria-label={
                isGridView ? "Switch to list view" : "Switch to grid view"
              }
            >
              {isGridView ? (
                <ListIcon class="w-5 h-5" />
              ) : (
                <Grid class="w-5 h-5" />
              )}
              <span class="hidden sm:inline">
                {isGridView ? "List view" : "Grid view"}
              </span>
            </button>

            {(filterGroup || searchQuery) && (
              <button
                onClick={() => {
                  setFilterGroup("");
                  setSearchQuery("");
                }}
                class="px-3 py-2 bg-red-900/30 text-red-300 border border-red-900/50 rounded-lg flex items-center gap-2 hover:bg-red-900/50"
                aria-label="Clear filters"
              >
                <span>Clear filters</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div class="flex items-center justify-center py-16">
          <Loader class="w-8 h-8 animate-spin text-blue-500" />
          <span class="ml-2">Loading channels...</span>
        </div>
      ) : error ? (
        <div class="bg-red-900/20 border border-red-700 p-4 rounded-lg text-red-200">
          <h3 class="font-medium mb-2">Error</h3>
          <p>{error}</p>
          <div class="mt-4 flex gap-3">
            <a
              href="/countries"
              class="inline-block px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-500"
            >
              Browse all channels
            </a>
            <button
              onClick={() => {
                setLoadAttempted(false);
                setLoading(true);
                setError(null);
                setTimeout(loadCategory, 100);
              }}
              class="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Try Again
            </button>
          </div>
        </div>
      ) : sortedChannels.length === 0 ? (
        <div class="bg-gray-800 p-6 rounded-lg">
          <div class="flex items-center gap-4">
            <AlertCircle class="w-8 h-8 text-yellow-500" />
            <div>
              <h3 class="font-medium mb-1">No channels found</h3>
              <p class="text-sm text-gray-400">
                Try another category or add more playlists.
              </p>
            </div>
          </div>
          <a
            href="/countries"
            class="mt-4 inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Browse all channels
          </a>
        </div>
      ) : (
        <>
          {isGridView ? (
            <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {/* Ensure we're only rendering valid items with proper keys */}
              {paginatedChannels.map(
                (channel) =>
                  channel && (
                    <a
                      key={channel.id || `channel-${Math.random()}`}
                      href={`/watch/${encodeURIComponent(
                        channel.url || channel.id
                      )}`}
                      class="bg-gray-800 p-4 rounded-lg hover:bg-gray-700 transition-colors"
                    >
                      {/* ...existing channel card content... */}
                      <div class="flex items-center gap-3 mb-3">
                        {/* Logo/initials display */}
                        {/* ...existing logo code... */}
                        <div class="flex-1 min-w-0">
                          <h3 class="font-medium truncate">
                            {channel.name || "Unnamed Channel"}
                          </h3>
                          <p class="text-xs text-gray-400 truncate">
                            {channel.group || "Uncategorized"}
                          </p>
                        </div>
                      </div>

                      {/* Categories */}
                      {channel.categories && channel.categories.length > 0 && (
                        <div class="flex flex-wrap gap-1 mt-2">
                          {channel.categories
                            .filter((cat) => {
                              const catId =
                                typeof cat === "string" ? cat : cat.id || "";
                              return (
                                catId.toLowerCase() !== categoryId.toLowerCase()
                              );
                            })
                            .slice(0, 2)
                            .map((cat, idx) => {
                              const catName =
                                typeof cat === "string"
                                  ? cat
                                  : cat.name || cat.id;
                              const catId =
                                typeof cat === "string" ? cat : cat.id || cat;

                              return (
                                <a
                                  key={`${channel.id}-cat-${idx}`}
                                  href={`/category/${catId.toLowerCase()}`}
                                  class="text-xs bg-blue-900/40 px-2 py-0.5 rounded-full text-blue-300"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {catName}
                                </a>
                              );
                            })}
                        </div>
                      )}
                    </a>
                  )
              )}
            </div>
          ) : (
            <div class="bg-gray-800 rounded-lg overflow-hidden">
              {paginatedChannels.map(
                (channel) =>
                  channel && (
                    <a
                      key={channel.id || `channel-${Math.random()}`}
                      href={`/watch/${encodeURIComponent(
                        channel.url || channel.id
                      )}`}
                      class="flex items-center p-4 hover:bg-gray-700 transition-colors border-b border-gray-700 last:border-0"
                    >
                      {channel.logo ? (
                        <img
                          src={channel.logo}
                          alt={channel.name || "Channel logo"}
                          class="w-12 h-12 rounded-md mr-3 object-cover bg-gray-900"
                          loading="lazy"
                          onError={(e) => {
                            e.target.onerror = null;
                            e.target.style.display = "none";
                            e.target.parentNode.innerHTML = `
                              <div class="w-12 h-12 rounded-md mr-3 flex-shrink-0 flex items-center justify-center"
                                   style="background-color: ${getChannelColor(channel.name)}">
                                <div class="text-white text-sm font-bold">
                                  ${getChannelInitials(channel.name)}
                                </div>
                              </div>
                            `;
                          }}
                        />
                      ) : (
                        <div
                          class="w-12 h-12 rounded-md mr-3 flex-shrink-0 flex items-center justify-center"
                          style={{
                            backgroundColor: getChannelColor(channel.name)
                          }}
                        >
                          <div class="text-white text-sm font-bold">
                            {getChannelInitials(channel.name)}
                          </div>
                        </div>
                      )}
                      
                      <div class="flex-1 min-w-0">
                        <h3 class="font-medium truncate">
                          {channel.name || "Unnamed Channel"}
                        </h3>
                        <p class="text-xs text-gray-400 truncate">
                          {channel.group || "Uncategorized"}
                        </p>
                        
                        {channel.categories && channel.categories.length > 0 && (
                          <div class="flex flex-wrap gap-1 mt-1">
                            {channel.categories
                              .filter((cat) => {
                                const catId = typeof cat === "string" ? cat : cat.id || "";
                                return catId.toLowerCase() !== categoryId.toLowerCase();
                              })
                              .slice(0, 2)
                              .map((cat, idx) => {
                                const catName = typeof cat === "string" ? cat : cat.name || cat.id;
                                const catId = typeof cat === "string" ? cat : cat.id || cat;
                                
                                return (
                                  <a
                                    key={`${channel.id}-list-cat-${idx}`}
                                    href={`/category/${catId.toLowerCase()}`}
                                    class="text-xs bg-gray-700 px-1.5 py-0.5 rounded-full text-gray-300"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {catName}
                                  </a>
                                );
                              })}
                          </div>
                        )}
                      </div>
                    </a>
                  )
              )}
            </div>
          )}

          {/* Pagination Controls */}
          {renderPaginationControls()}

          {/* Stats */}
          {sortedChannels.length > 0 && (
            <div class="mt-6 text-center text-sm text-gray-500">
              {filteredChannels.length} channels in this category
              {filteredChannels.length > channelsPerPage && (
                <span> (showing {paginatedChannels.length} per page)</span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
